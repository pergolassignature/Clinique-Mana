-- =============================================================================
-- Module Services et tarifs (« services »): registry, tables, catalogue seed, RPCs (plan S1–S2)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §5 (Keep / Change / Drop, data model)
-- Roadmap:   docs/plans/2026-10-11-next-modules-roadmap.md §2.1
-- Data:      docs/research/2026-10-11-gorendezvous-tour.md §3, §18 (the real catalogue)
-- Decisions: R-3 (one catalogue), R-4 (prices from the retention grids), R-5 (student and
--            reduced rates as dated variants), R-37 (fee mode « confirm »), R-41 (admin
--            services: amount typed on the invoice), R-45 (seeds), R-59 (the professional
--            decides the fee), R-64 (taxes confirmed by Christine), S-1 … S-6 (decisions log).
-- Recipe:    docs/standards/database-conventions.md §9
--
-- One catalogue per clinic, coded like GOrendezvous (families 10xxx–80xxx, the code is the
-- QuickBooks item), with the duration, the slot it occupies (« pause après »), the taxes and
-- the SOURCE of the price: the retention grid of the professional's title (`grid`, the price
-- is never copied here), a fixed amount (`fixed`), free, or an amount typed on the invoice
-- line (`entered`). Which profession titles offer a service is `service_titles`. Student and
-- reduced rates are dated variants (`service_rate_variants`), general or per title. The
-- cancellation policy is a dated row (`billing_policies`), read by Facturation.
--
-- Published (other modules read these, never the tables): the view `services_catalog`,
-- `get_service_price(…)` and `billing_policy_on(…)` for clients, `private.service_price(…)`
-- for definer callers (Rendez-vous, Facturation). The module starts disabled everywhere.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('services', 'Services et tarifs')
on conflict do nothing;

insert into public.module_dependencies (module_key, depends_on) values ('services', 'professionals')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('services.view',   'services', 'Voir les services et les tarifs'),
  ('services.manage', 'services', 'Gérer les services et les tarifs')
on conflict do nothing;

-- Defaults (plan §1): everyone reads the catalogue (the professional sees her own prices);
-- the administration and the adjointe change it.
insert into public.role_permissions (role, permission_key) values
  ('admin',           'services.view'),
  ('admin',           'services.manage'),
  ('counselor',       'services.view'),
  ('admin_assistant', 'services.view'),
  ('admin_assistant', 'services.manage'),
  ('provider',        'services.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Shared checks (granted to no role)
-- -----------------------------------------------------------------------------
create function private.assert_services_manage()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission('services.manage') then
    raise exception 'Permission refusée : services.manage' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_services_manage() from public, anon, authenticated, service_role;

-- A dated row's start: required, a real day of 2000–2100, after the open row's start (as the
-- tax rates and the compensation terms). HINT effective_from, so the form marks the field.
create function private.assert_services_start(p_new date, p_open date, p_message text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_new is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001', hint = 'effective_from';
  end if;
  if p_new < date '2000-01-01' or p_new > date '2100-12-31' then
    raise exception 'La date doit être comprise entre le 1 janv. 2000 et le 31 déc. 2100.' using errcode = 'P0001', hint = 'effective_from';
  end if;
  if p_open is not null and p_new <= p_open then
    raise exception '% %.', p_message, private.format_date_short_fr(p_open) using errcode = 'P0001', hint = 'effective_from';
  end if;
end;
$$;
revoke all on function private.assert_services_start(date, date, text) from public, anon, authenticated, service_role;

-- The correction window of a dated row's deletion: not in force yet, or created less than 24 h ago.
create function private.assert_services_deletable(p_effective_from date, p_created_at timestamptz, p_message text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_effective_from <= private.clinic_today() and p_created_at < pg_catalog.now() - interval '24 hours' then
    raise exception '%', p_message using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.assert_services_deletable(date, timestamp with time zone, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- service_families: GOrendezvous's numbered families (10 Individuel … 80 Frais de déplacement)
-- -----------------------------------------------------------------------------
create table public.service_families (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code smallint not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_families_code_check check (code between 10 and 80 and code % 10 = 0),
  constraint service_families_name_check check (char_length(name) between 1 and 80 and private.is_tidy_text(name)),
  constraint service_families_org_id_code_key unique (org_id, code),
  constraint service_families_org_id_id_key unique (org_id, id)
);
create index service_families_org_sort_idx on public.service_families (org_id, sort_order, code);

-- -----------------------------------------------------------------------------
-- services: the catalogue
-- -----------------------------------------------------------------------------
-- code: five digits whose first two are the family's (10150 is in family 10), the QuickBooks
-- item, set once. key: English identifier, set once. kind: session (a consultation), call
-- (a short call), fee (file opening, cancellation, travel), workshop, admin (report, test,
-- supervision…). duration_minutes 0 for anything without a slot; buffer_after_minutes is the
-- « pause après » (a 50 min session books 60, R-13). price_source: grid (the retention grid's
-- column grid_duration of the professional's title), fixed (fixed_price_cents), free, entered
-- (Facturation asks the amount). tax_rule: exempt or taxable (the list confirmed by Christine,
-- R-64); a tax exemption of the client (« Statut Indien ») is the caller's (get_service_price's
-- p_tax_exempt). for_two: a couple service, invoiced to two people by Facturation.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  family_id uuid not null,
  code int not null,
  key text not null,
  name text not null,
  description text,
  kind text not null,
  duration_minutes smallint not null default 0,
  buffer_after_minutes smallint not null default 0,
  for_two boolean not null default false,
  price_source text not null,
  fixed_price_cents int,
  grid_duration smallint,
  tax_rule text not null default 'exempt',
  colour text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint services_org_id_id_key unique (org_id, id),
  constraint services_org_id_code_key unique (org_id, code),
  constraint services_org_id_key_key unique (org_id, key),
  constraint services_family_fkey foreign key (org_id, family_id) references public.service_families (org_id, id),
  constraint services_code_check check (code between 10000 and 89999),
  constraint services_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint services_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint services_description_check check (char_length(description) between 1 and 1000 and private.is_tidy_text(description)),
  constraint services_kind_check check (kind in ('session', 'call', 'fee', 'workshop', 'admin')),
  constraint services_duration_minutes_check check (duration_minutes between 0 and 480),
  constraint services_buffer_after_minutes_check check (buffer_after_minutes between 0 and 120),
  constraint services_price_source_check check (price_source in ('grid', 'fixed', 'free', 'entered')),
  constraint services_fixed_price_cents_check check (fixed_price_cents between 1 and 1000000),
  constraint services_fixed_price_check check ((price_source = 'fixed') = (fixed_price_cents is not null)),
  constraint services_grid_duration_check check (grid_duration in (60, 50, 30)),
  constraint services_grid_check check ((price_source = 'grid') = (grid_duration is not null)),
  constraint services_tax_rule_check check (tax_rule in ('exempt', 'taxable')),
  constraint services_colour_check check (colour ~ '^#[0-9a-f]{6}$')
);
create index services_org_family_idx on public.services (org_id, family_id, sort_order, code);
create index services_created_by_idx on public.services (created_by);
create index services_updated_by_idx on public.services (updated_by);
create trigger services_set_updated_at before update on public.services
  for each row execute function private.set_updated_at();

-- The code stays inside its family's range (10xxx in family 10): a cross-table rule.
create function private.services_check_code_in_family()
returns trigger
language plpgsql
stable
set search_path = ''
as $$
declare
  v_family smallint;
begin
  select f.code into v_family from public.service_families f where f.org_id = new.org_id and f.id = new.family_id;
  if v_family is null or new.code / 1000 <> v_family then
    raise exception 'Le code % n''est pas dans la plage de sa famille (% 000 à % 999).', new.code, v_family, v_family
      using errcode = 'P0001', hint = 'code';
  end if;
  return new;
end;
$$;
revoke all on function private.services_check_code_in_family() from public, anon, authenticated, service_role;
create trigger services_check_code_in_family before insert or update of code, family_id on public.services
  for each row execute function private.services_check_code_in_family();

-- -----------------------------------------------------------------------------
-- service_titles: which profession titles offer a service
-- -----------------------------------------------------------------------------
create table public.service_titles (
  org_id uuid not null,
  service_id uuid not null,
  profession_title_id uuid not null,
  created_at timestamptz not null default now(),
  constraint service_titles_pkey primary key (service_id, profession_title_id),
  constraint service_titles_service_fkey foreign key (org_id, service_id) references public.services (org_id, id) on delete cascade,
  constraint service_titles_title_fkey foreign key (org_id, profession_title_id) references public.profession_titles (org_id, id) on delete cascade
);
create index service_titles_org_title_idx on public.service_titles (org_id, profession_title_id);

-- -----------------------------------------------------------------------------
-- service_rate_variants: student and reduced rates, dated, general or per title (R-5)
-- -----------------------------------------------------------------------------
-- discount_kind: price (the variant's price replaces the base price, amount_cents), amount (taken
-- off the base price, amount_cents), percent (percent off). A row for a title wins over the
-- general row of the same variant. Periods never overlap per (service, variant, title).
create table public.service_rate_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  variant text not null,
  profession_title_id uuid,
  discount_kind text not null,
  amount_cents int,
  percent numeric(5, 2),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint service_rate_variants_service_fkey foreign key (org_id, service_id) references public.services (org_id, id) on delete cascade,
  constraint service_rate_variants_title_fkey foreign key (org_id, profession_title_id) references public.profession_titles (org_id, id) on delete cascade,
  constraint service_rate_variants_variant_check check (variant in ('student', 'reduced')),
  constraint service_rate_variants_discount_kind_check check (discount_kind in ('price', 'amount', 'percent')),
  constraint service_rate_variants_amount_cents_check check (amount_cents between 0 and 1000000),
  constraint service_rate_variants_percent_check check (percent > 0 and percent <= 100),
  constraint service_rate_variants_value_check check (
    (discount_kind in ('price', 'amount') and amount_cents is not null and percent is null)
    or (discount_kind = 'percent' and percent is not null and amount_cents is null)),
  constraint service_rate_variants_period_check check (effective_to is null or effective_to > effective_from),
  constraint service_rate_variants_no_overlap exclude using gist (
    org_id with =,
    service_id with =,
    variant with =,
    coalesce(profession_title_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index service_rate_variants_org_service_idx on public.service_rate_variants (org_id, service_id, variant, effective_from);
create index service_rate_variants_created_by_idx on public.service_rate_variants (created_by);

-- -----------------------------------------------------------------------------
-- billing_policies: the cancellation policy, dated (R-6, R-37)
-- -----------------------------------------------------------------------------
-- late_notice_hours: the notice under which a cancellation is late. first_fee_percent at the
-- first late cancellation or absence, next_fee_percent after. fee_mode: confirm (the fee line is
-- proposed; the professional decides whether it applies, or the adjointe on their behalf, R-59)
-- or automatic (never on by default). file_opening_service_id: the file-opening service
-- Facturation adds to a first appointment (null: none).
create table public.billing_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  late_notice_hours smallint not null default 24,
  first_fee_percent numeric(5, 2) not null default 50,
  next_fee_percent numeric(5, 2) not null default 100,
  file_opening_service_id uuid,
  fee_mode text not null default 'confirm',
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint billing_policies_file_opening_fkey foreign key (org_id, file_opening_service_id) references public.services (org_id, id),
  constraint billing_policies_late_notice_hours_check check (late_notice_hours between 1 and 168),
  constraint billing_policies_first_fee_percent_check check (first_fee_percent between 0 and 100),
  constraint billing_policies_next_fee_percent_check check (next_fee_percent between 0 and 100),
  constraint billing_policies_fee_mode_check check (fee_mode in ('confirm', 'automatic')),
  constraint billing_policies_period_check check (effective_to is null or effective_to > effective_from),
  constraint billing_policies_no_overlap exclude using gist (
    org_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index billing_policies_org_from_idx on public.billing_policies (org_id, effective_from);
create index billing_policies_created_by_idx on public.billing_policies (created_by);

-- -----------------------------------------------------------------------------
-- Privileges, RLS, audit
-- -----------------------------------------------------------------------------
revoke all on public.service_families, public.services, public.service_titles, public.service_rate_variants, public.billing_policies
  from anon, authenticated;
grant select on public.service_families, public.services, public.service_titles, public.service_rate_variants, public.billing_policies
  to authenticated;

alter table public.service_families enable row level security;
alter table public.services enable row level security;
alter table public.service_titles enable row level security;
alter table public.service_rate_variants enable row level security;
alter table public.billing_policies enable row level security;

create policy service_families_select on public.service_families
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('services.view')));
create policy services_select on public.services
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('services.view')));
create policy service_titles_select on public.service_titles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('services.view')));
create policy service_rate_variants_select on public.service_rate_variants
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('services.view')));
create policy billing_policies_select on public.billing_policies
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('services.view')));

create trigger service_families_audit after insert or update or delete on public.service_families
  for each row execute function private.audit_trigger();
create trigger services_audit after insert or update or delete on public.services
  for each row execute function private.audit_trigger();
create trigger service_titles_audit after insert or update or delete on public.service_titles
  for each row execute function private.audit_trigger();
create trigger service_rate_variants_audit after insert or update or delete on public.service_rate_variants
  for each row execute function private.audit_trigger();
create trigger billing_policies_audit after insert or update or delete on public.billing_policies
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Published view: the active catalogue with its family and titles
-- -----------------------------------------------------------------------------
create view public.services_catalog with (security_invoker = true) as
select s.id, s.org_id, s.code, s.key, s.name, s.description, s.kind,
       s.duration_minutes, s.buffer_after_minutes, s.for_two,
       s.price_source, s.fixed_price_cents, s.grid_duration, s.tax_rule, s.colour, s.sort_order,
       f.id as family_id, f.code as family_code, f.name as family_name, f.sort_order as family_sort_order,
       coalesce(t.ids, '{}') as title_ids,
       coalesce(t.keys, '{}') as title_keys,
       s.updated_at
  from public.services s
  join public.service_families f on f.org_id = s.org_id and f.id = s.family_id
  -- One pre-aggregated join (grouped once per statement), never a call per row.
  left join (select x.service_id,
                    array_agg(x.profession_title_id order by pt.sort_order, pt.key) as ids,
                    array_agg(pt.key order by pt.sort_order, pt.key) as keys
               from public.service_titles x
               join public.profession_titles pt on pt.org_id = x.org_id and pt.id = x.profession_title_id
              group by x.service_id) t on t.service_id = s.id
 where s.is_active;
revoke all on public.services_catalog from anon, authenticated;
grant select on public.services_catalog to authenticated;

-- -----------------------------------------------------------------------------
-- The price of a service (the one place it is computed)
-- -----------------------------------------------------------------------------
-- For definer callers (Rendez-vous, Facturation: after their own permission check, with the org
-- they verified). price_cents: the price in force on p_on, null when it is typed on the invoice
-- (`entered`) or when the grid has none (« À confirmer »). tax_rule: the service's, `exempt`
-- when the client is tax-exempt (p_tax_exempt, « Statut Indien »). source: the service's
-- price_source. variant_applied: whether a student or reduced rate in force was applied (a
-- title's row first, else the general one; none in force → the base price, false).
create function private.service_price(p_org uuid, p_service_id uuid, p_title_id uuid, p_variant text, p_on date, p_tax_exempt boolean)
returns table (price_cents int, tax_rule text, source text, variant_applied boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_service public.services;
  v_variant public.service_rate_variants;
  v_price int;
  v_rule text;
  v_applied boolean := false;
begin
  if p_service_id is null or p_on is null then
    raise exception 'Le service et la date sont requis.' using errcode = '22023';
  end if;
  select s.* into v_service from public.services s where s.org_id = p_org and s.id = p_service_id;
  if v_service.id is null then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
  if p_variant is not null and p_variant not in ('student', 'reduced') then
    raise exception 'Variante de tarif inconnue : %', p_variant using errcode = '22023';
  end if;

  v_price := case v_service.price_source
               when 'fixed' then v_service.fixed_price_cents
               when 'free' then 0
               when 'grid' then private.grid_client_price(p_org, p_title_id, v_service.grid_duration, p_on)
               else null
             end;

  if p_variant is not null and v_price is not null then
    select v.* into v_variant
      from public.service_rate_variants v
     where v.org_id = p_org and v.service_id = p_service_id and v.variant = p_variant
       and (v.profession_title_id is null or v.profession_title_id = p_title_id)
       and v.effective_from <= p_on and (v.effective_to is null or p_on < v.effective_to)
     order by (v.profession_title_id is null), v.effective_from desc
     limit 1;
    if v_variant.id is not null then
      v_applied := true;
      v_price := case v_variant.discount_kind
                   when 'price' then v_variant.amount_cents
                   when 'amount' then greatest(v_price - v_variant.amount_cents, 0)
                   else pg_catalog.round(v_price * (1 - v_variant.percent / 100))::int
                 end;
    end if;
  end if;

  v_rule := case when coalesce(p_tax_exempt, false) then 'exempt' else v_service.tax_rule end;

  return query select v_price, v_rule, v_service.price_source, v_applied;
end;
$$;
revoke all on function private.service_price(uuid, uuid, uuid, text, date, boolean) from public, anon, authenticated, service_role;

-- For clients (the settings page's « Aperçu des prix », Rendez-vous' booking form): the caller's
-- clinic, `services.view` first (a provider reads her own prices; a disabled module refuses).
create function public.get_service_price(p_service_id uuid, p_title_id uuid, p_variant text, p_on date, p_tax_exempt boolean default false)
returns table (price_cents int, tax_rule text, source text, variant_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('services.view') then
    raise exception 'Permission refusée : services.view' using errcode = '42501';
  end if;
  return query select * from private.service_price(private.current_user_org_id(), p_service_id, p_title_id, p_variant, p_on, p_tax_exempt);
end;
$$;
revoke all on function public.get_service_price(uuid, uuid, text, date, boolean) from public, anon, authenticated;
grant execute on function public.get_service_price(uuid, uuid, text, date, boolean) to authenticated;

-- The cancellation policy in force on a date (the caller's clinic, through the table's RLS):
-- no row when none applies.
create function public.billing_policy_on(p_on date)
returns setof public.billing_policies
language sql
stable
set search_path = ''
as $$
  select b.*
    from public.billing_policies b
   where b.org_id = (select private.current_user_org_id())
     and b.effective_from <= p_on
     and (b.effective_to is null or p_on < b.effective_to)
$$;
revoke all on function public.billing_policy_on(date) from public, anon, authenticated;
grant execute on function public.billing_policy_on(date) to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs: the catalogue (services.manage)
-- -----------------------------------------------------------------------------
-- Creates (p_id null) or updates a service. The key and the code are set once: a different
-- value on update is refused (HINT key / code). A code already used or outside its family's
-- range, a key already used, a fixed source without a price or a grid source without its
-- column: refused in French on the field (HINT).
create function public.save_service(
  p_id uuid,
  p_family_id uuid,
  p_code int,
  p_key text,
  p_name text,
  p_description text,
  p_kind text,
  p_duration_minutes int,
  p_buffer_after_minutes int,
  p_for_two boolean,
  p_price_source text,
  p_fixed_price_cents int,
  p_grid_duration int,
  p_tax_rule text,
  p_colour text,
  p_sort_order int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_existing public.services;
  v_id uuid;
  v_name text := nullif(pg_catalog.btrim(p_name), '');
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_key text := nullif(pg_catalog.btrim(p_key), '');
  v_colour text := nullif(pg_catalog.lower(pg_catalog.btrim(p_colour)), '');
begin
  perform private.assert_services_manage();

  if v_name is null or char_length(v_name) > 120 or not private.is_tidy_text(v_name) then
    raise exception 'Le nom est requis (120 caractères au plus).' using errcode = 'P0001', hint = 'name';
  end if;
  if v_description is not null and (char_length(v_description) > 1000 or not private.is_tidy_text(v_description)) then
    raise exception 'La description compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'description';
  end if;
  if p_kind is null or p_kind not in ('session', 'call', 'fee', 'workshop', 'admin') then
    raise exception 'Le type de service est requis.' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 0 and 480 then
    raise exception 'La durée est comprise entre 0 et 480 minutes.' using errcode = 'P0001', hint = 'duration_minutes';
  end if;
  if p_buffer_after_minutes is null or p_buffer_after_minutes not between 0 and 120 then
    raise exception 'La pause après est comprise entre 0 et 120 minutes.' using errcode = 'P0001', hint = 'buffer_after_minutes';
  end if;
  if p_price_source is null or p_price_source not in ('grid', 'fixed', 'free', 'entered') then
    raise exception 'La source du prix est requise.' using errcode = 'P0001', hint = 'price_source';
  end if;
  if p_price_source = 'fixed' and (p_fixed_price_cents is null or p_fixed_price_cents not between 1 and 1000000) then
    raise exception 'Un prix fixe est compris entre 0,01 $ et 10 000 $.' using errcode = 'P0001', hint = 'fixed_price_cents';
  end if;
  if p_price_source = 'grid' and (p_grid_duration is null or p_grid_duration not in (60, 50, 30)) then
    raise exception 'Un prix selon la grille indique sa durée : 60, 50 ou 30 minutes.' using errcode = 'P0001', hint = 'grid_duration';
  end if;
  if p_tax_rule is null or p_tax_rule not in ('exempt', 'taxable') then
    raise exception 'La règle de taxe est requise.' using errcode = 'P0001', hint = 'tax_rule';
  end if;
  if v_colour is not null and v_colour !~ '^#[0-9a-f]{6}$' then
    raise exception 'La couleur est un code hexadécimal (#1a2b3c).' using errcode = 'P0001', hint = 'colour';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 100000 then
    raise exception 'L''ordre est un nombre entre 0 et 100 000.' using errcode = 'P0001', hint = 'sort_order';
  end if;

  if p_id is null then
    if p_family_id is null or not exists (select 1 from public.service_families f where f.org_id = v_org and f.id = p_family_id) then
      raise exception 'La famille est requise.' using errcode = 'P0001', hint = 'family_id';
    end if;
    if p_code is null or p_code not between 10000 and 89999 then
      raise exception 'Le code compte cinq chiffres (10000 à 89999).' using errcode = 'P0001', hint = 'code';
    end if;
    if exists (select 1 from public.services s where s.org_id = v_org and s.code = p_code) then
      raise exception 'Le code % est déjà utilisé par un autre service.', p_code using errcode = 'P0001', hint = 'code';
    end if;
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,49}$' then
      raise exception 'La clé commence par une lettre minuscule et compte des lettres minuscules, des chiffres et des _ (50 caractères au plus).'
        using errcode = 'P0001', hint = 'key';
    end if;
    if exists (select 1 from public.services s where s.org_id = v_org and s.key = v_key) then
      raise exception 'La clé « % » est déjà utilisée par un autre service.', v_key using errcode = 'P0001', hint = 'key';
    end if;
    insert into public.services
      (org_id, family_id, code, key, name, description, kind, duration_minutes, buffer_after_minutes, for_two,
       price_source, fixed_price_cents, grid_duration, tax_rule, colour, sort_order, created_by, updated_by)
    values
      (v_org, p_family_id, p_code, v_key, v_name, v_description, p_kind, p_duration_minutes, p_buffer_after_minutes, coalesce(p_for_two, false),
       p_price_source, case when p_price_source = 'fixed' then p_fixed_price_cents end,
       case when p_price_source = 'grid' then p_grid_duration::smallint end, p_tax_rule, v_colour, p_sort_order, auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select s.* into v_existing from public.services s where s.org_id = v_org and s.id = p_id for no key update;
  if v_existing.id is null then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
  if p_code is not null and p_code <> v_existing.code then
    raise exception 'Le code d''un service ne change pas une fois créé.' using errcode = 'P0001', hint = 'code';
  end if;
  if v_key is not null and v_key <> v_existing.key then
    raise exception 'La clé d''un service ne change pas une fois créée.' using errcode = 'P0001', hint = 'key';
  end if;
  if p_family_id is not null and p_family_id <> v_existing.family_id then
    raise exception 'La famille d''un service ne change pas une fois créé (son code en fait partie).' using errcode = 'P0001', hint = 'family_id';
  end if;
  update public.services s
     set name = v_name,
         description = v_description,
         kind = p_kind,
         duration_minutes = p_duration_minutes,
         buffer_after_minutes = p_buffer_after_minutes,
         for_two = coalesce(p_for_two, false),
         price_source = p_price_source,
         fixed_price_cents = case when p_price_source = 'fixed' then p_fixed_price_cents end,
         grid_duration = case when p_price_source = 'grid' then p_grid_duration::smallint end,
         tax_rule = p_tax_rule,
         colour = v_colour,
         sort_order = p_sort_order,
         updated_by = auth.uid()
   where s.org_id = v_org and s.id = p_id;
  return p_id;
end;
$$;
revoke all on function public.save_service(uuid, uuid, int, text, text, text, text, int, int, boolean, text, int, int, text, text, int) from public, anon, authenticated;
grant execute on function public.save_service(uuid, uuid, int, text, text, text, text, int, int, boolean, text, int, int, text, text, int) to authenticated;

-- Archives (false) or restores (true) a service. An archived service leaves the published
-- catalogue; what was invoiced keeps its reference.
create function public.set_service_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.assert_services_manage();
  if p_active is null then
    raise exception 'p_active est requis' using errcode = '22023';
  end if;
  update public.services s set is_active = p_active, updated_by = auth.uid()
   where s.org_id = v_org and s.id = p_id and s.is_active is distinct from p_active;
  if not found and not exists (select 1 from public.services s where s.org_id = v_org and s.id = p_id) then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.set_service_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_service_active(uuid, boolean) to authenticated;

-- Replaces the titles that offer a service. Rows kept as they are are not rewritten (no audit
-- noise). A title of another clinic or unknown: refused.
create function public.set_service_titles(p_id uuid, p_title_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[] := coalesce(p_title_ids, '{}');
begin
  perform private.assert_services_manage();
  if not exists (select 1 from public.services s where s.org_id = v_org and s.id = p_id) then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) as x(id)
              where x.id is null or not exists (select 1 from public.profession_titles t where t.org_id = v_org and t.id = x.id)) then
    raise exception 'Un des titres choisis n''existe pas.' using errcode = 'P0001', hint = 'title_ids';
  end if;

  delete from public.service_titles st
   where st.org_id = v_org and st.service_id = p_id and st.profession_title_id <> all (v_ids);
  insert into public.service_titles (org_id, service_id, profession_title_id)
  select v_org, p_id, x.id from pg_catalog.unnest(v_ids) as x(id)
  on conflict do nothing;
  update public.services s set updated_by = auth.uid(), updated_at = pg_catalog.now() where s.org_id = v_org and s.id = p_id;
end;
$$;
revoke all on function public.set_service_titles(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_service_titles(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs: student and reduced rates (services.manage)
-- -----------------------------------------------------------------------------
-- Appends a dated variant for (service, variant, title or general): closes the open row of that
-- series on p_effective_from, which must start after it (as add_tax_rate). p_discount_kind:
-- price (p_amount_cents is the variant's price), amount (taken off), percent (p_percent off).
create function public.add_service_rate_variant(
  p_service_id uuid,
  p_variant text,
  p_title_id uuid,
  p_discount_kind text,
  p_amount_cents int,
  p_percent numeric,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.service_rate_variants;
  v_id uuid;
  v_percent numeric := pg_catalog.round(p_percent, 2);
begin
  perform private.assert_services_manage();
  perform 1 from public.organizations o where o.id = v_org for no key update;
  if not exists (select 1 from public.services s where s.org_id = v_org and s.id = p_service_id) then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
  if p_variant is null or p_variant not in ('student', 'reduced') then
    raise exception 'La variante est « Tarif étudiant » ou « Tarif réduit ».' using errcode = 'P0001', hint = 'variant';
  end if;
  if p_title_id is not null and not exists (select 1 from public.profession_titles t where t.org_id = v_org and t.id = p_title_id) then
    raise exception 'Le titre choisi n''existe pas.' using errcode = 'P0001', hint = 'title_id';
  end if;
  if p_discount_kind is null or p_discount_kind not in ('price', 'amount', 'percent') then
    raise exception 'Le rabais est un prix, un montant ou un pourcentage.' using errcode = 'P0001', hint = 'discount_kind';
  end if;
  if p_discount_kind in ('price', 'amount') and (p_amount_cents is null or p_amount_cents not between 0 and 1000000) then
    raise exception 'Le montant est compris entre 0 $ et 10 000 $.' using errcode = 'P0001', hint = 'amount_cents';
  end if;
  if p_discount_kind = 'percent' and (v_percent is null or v_percent <= 0 or v_percent > 100) then
    raise exception 'Le pourcentage est compris entre 0,01 %% et 100 %%.' using errcode = 'P0001', hint = 'percent';
  end if;

  select v.* into v_open
    from public.service_rate_variants v
   where v.org_id = v_org and v.service_id = p_service_id and v.variant = p_variant
     and v.profession_title_id is not distinct from p_title_id and v.effective_to is null;
  perform private.assert_services_start(p_effective_from, v_open.effective_from, 'La date doit être postérieure au début du tarif en vigueur, le');

  if v_open.id is not null then
    update public.service_rate_variants v set effective_to = p_effective_from where v.id = v_open.id;
  end if;
  insert into public.service_rate_variants
    (org_id, service_id, variant, profession_title_id, discount_kind, amount_cents, percent, effective_from, created_by)
  values
    (v_org, p_service_id, p_variant, p_title_id, p_discount_kind,
     case when p_discount_kind = 'percent' then null else p_amount_cents end,
     case when p_discount_kind = 'percent' then v_percent end,
     p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_service_rate_variant(uuid, text, uuid, text, int, numeric, date) from public, anon, authenticated;
grant execute on function public.add_service_rate_variant(uuid, text, uuid, text, int, numeric, date) to authenticated;

-- Ends an open variant on p_effective_to (its last day is the day before), or deletes it when
-- it is not in force yet or was created less than 24 hours ago (p_effective_to null): a
-- correction; the previous row of the series opens again.
create function public.end_service_rate_variant(p_id uuid, p_effective_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.service_rate_variants;
begin
  perform private.assert_services_manage();
  select v.* into v_row from public.service_rate_variants v where v.org_id = v_org and v.id = p_id for no key update;
  if v_row.id is null then
    raise exception 'Tarif introuvable.' using errcode = 'P0001';
  end if;
  if p_effective_to is null then
    perform private.assert_services_deletable(v_row.effective_from, v_row.created_at,
      'Un tarif déjà en vigueur ne peut pas être supprimé : terminez-le à une date.');
    if v_row.effective_to is not null and exists (select 1 from public.service_rate_variants v
                                                   where v.org_id = v_org and v.service_id = v_row.service_id and v.variant = v_row.variant
                                                     and v.profession_title_id is not distinct from v_row.profession_title_id
                                                     and v.effective_from > v_row.effective_from) then
      raise exception 'Seul le dernier tarif de la série peut être supprimé.' using errcode = 'P0001';
    end if;
    delete from public.service_rate_variants v where v.id = p_id;
    update public.service_rate_variants v set effective_to = null
     where v.org_id = v_org and v.service_id = v_row.service_id and v.variant = v_row.variant
       and v.profession_title_id is not distinct from v_row.profession_title_id and v.effective_to = v_row.effective_from;
    return;
  end if;
  if v_row.effective_to is not null then
    raise exception 'Ce tarif est déjà terminé.' using errcode = 'P0001';
  end if;
  if p_effective_to <= v_row.effective_from or p_effective_to > date '2100-12-31' then
    raise exception 'La fin doit être postérieure au début du tarif, le %.', private.format_date_short_fr(v_row.effective_from)
      using errcode = 'P0001', hint = 'effective_to';
  end if;
  update public.service_rate_variants v set effective_to = p_effective_to where v.id = p_id;
end;
$$;
revoke all on function public.end_service_rate_variant(uuid, date) from public, anon, authenticated;
grant execute on function public.end_service_rate_variant(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs: the cancellation policy (services.manage)
-- -----------------------------------------------------------------------------
-- Appends a policy from p_effective_from (closes the open one). fee_mode `automatic` only with
-- Jonathan's and Christine's explicit go (R-37, R-59): the RPC accepts it, the default stays confirm.
create function public.add_billing_policy(
  p_effective_from date,
  p_late_notice_hours int,
  p_first_fee_percent numeric,
  p_next_fee_percent numeric,
  p_file_opening_service_id uuid,
  p_fee_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.billing_policies;
  v_id uuid;
  v_first numeric := pg_catalog.round(p_first_fee_percent, 2);
  v_next numeric := pg_catalog.round(p_next_fee_percent, 2);
begin
  perform private.assert_services_manage();
  perform 1 from public.organizations o where o.id = v_org for no key update;
  if p_late_notice_hours is null or p_late_notice_hours not between 1 and 168 then
    raise exception 'Le préavis est compris entre 1 et 168 heures.' using errcode = 'P0001', hint = 'late_notice_hours';
  end if;
  if v_first is null or v_first not between 0 and 100 then
    raise exception 'Les frais de la première fois sont compris entre 0 %% et 100 %%.' using errcode = 'P0001', hint = 'first_fee_percent';
  end if;
  if v_next is null or v_next not between 0 and 100 then
    raise exception 'Les frais des fois suivantes sont compris entre 0 %% et 100 %%.' using errcode = 'P0001', hint = 'next_fee_percent';
  end if;
  if p_file_opening_service_id is not null
     and not exists (select 1 from public.services s where s.org_id = v_org and s.id = p_file_opening_service_id and s.is_active) then
    raise exception 'Le service d''ouverture de dossier choisi n''existe pas ou est archivé.' using errcode = 'P0001', hint = 'file_opening_service_id';
  end if;
  if p_fee_mode is null or p_fee_mode not in ('confirm', 'automatic') then
    raise exception 'Le mode des frais est « À confirmer » ou « Automatique ».' using errcode = 'P0001', hint = 'fee_mode';
  end if;

  select b.* into v_open from public.billing_policies b where b.org_id = v_org and b.effective_to is null;
  perform private.assert_services_start(p_effective_from, v_open.effective_from, 'La date doit être postérieure au début de la politique en vigueur, le');

  if v_open.id is not null then
    update public.billing_policies b set effective_to = p_effective_from where b.id = v_open.id;
  end if;
  insert into public.billing_policies
    (org_id, effective_from, late_notice_hours, first_fee_percent, next_fee_percent, file_opening_service_id, fee_mode, created_by)
  values (v_org, p_effective_from, p_late_notice_hours, v_first, v_next, p_file_opening_service_id, p_fee_mode, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_billing_policy(date, int, numeric, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.add_billing_policy(date, int, numeric, numeric, uuid, text) to authenticated;

-- Deletes the last policy while it is not in force yet or within 24 hours of its creation; the
-- previous one opens again. The first policy of the clinic stays (Facturation always finds one).
create function public.delete_billing_policy(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.billing_policies;
begin
  perform private.assert_services_manage();
  select b.* into v_row from public.billing_policies b where b.org_id = v_org and b.id = p_id for no key update;
  if v_row.id is null then
    raise exception 'Politique introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seule la dernière politique peut être supprimée.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.billing_policies b where b.org_id = v_org and b.effective_to = v_row.effective_from) then
    raise exception 'La première politique de la clinique ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  perform private.assert_services_deletable(v_row.effective_from, v_row.created_at, 'Une politique déjà en vigueur ne peut pas être supprimée.');
  delete from public.billing_policies b where b.id = p_id;
  update public.billing_policies b set effective_to = null where b.org_id = v_org and b.effective_to = v_row.effective_from;
end;
$$;
revoke all on function public.delete_billing_policy(uuid) from public, anon, authenticated;
grant execute on function public.delete_billing_policy(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Seed: GOrendezvous's real catalogue for every clinic (R-45, visite §18)
-- -----------------------------------------------------------------------------
-- The 8 families and the 27 coded services of the « Z MATRICE » template, with their codes so
-- the import maps 1:1 and QuickBooks items keep their names. PRÉSENTIEL codes (10154, 10155,
-- 20151, 20161) are dropped and map to their online twin at import; the student and reduced
-- services (10131, 10151, 10152) are variants of 10130 / 10150 here. Naturopathie (10157) is
-- inactive until a naturopath is active. Titles per service follow the per-profession
-- observations (psychologie has no couple, IVAC or PAE services; the counsellor's services have
-- no title). Taxes as Christine confirmed them (R-64); couple 30 min taxable as the template says.
-- A clinic already holding a family or a service code keeps it (idempotent).
create function private.seed_services_catalogue(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_start constant date := date '2026-07-01';
  r record;
  v_family uuid;
  v_service uuid;
  v_opening uuid;
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:services_catalogue', true);

  insert into public.service_families (org_id, code, name, sort_order)
  select p_org, d.code, d.name, d.code
    from (values
      (10, 'Individuel'), (20, 'Couple et famille'), (30, 'IVAC'), (40, 'PAE externe'),
      (50, 'Administratif'), (60, 'Ateliers'), (70, 'Annulation tardive et absence'), (80, 'Frais de déplacement')
    ) as d(code, name)
   where not exists (select 1 from public.service_families f where f.org_id = p_org and f.code = d.code);

  for r in
    select * from (values
      -- code,  key,                               name,                                                   kind,       dur, buf, two,   source,    fixed, grid, tax,          active, titles
      (10100, 'file_opening_individual',          'Ouverture de dossier – individuel',                    'fee',       0,   0, false, 'fixed',   3783,  null, 'taxable',    true,  'all'),
      (10130, 'individual_30',                    'Consultation individuelle 30 min',                     'session',  30,   0, false, 'grid',    null,  30,   'exempt',     true,  'therapy'),
      (10150, 'individual_50',                    'Consultation individuelle 50 min',                     'session',  50,  10, false, 'grid',    null,  50,   'exempt',     true,  'therapy'),
      (10157, 'naturopathy',                      'Consultation naturopathie',                            'session',  50,  10, false, 'grid',    null,  50,   'taxable',    false, 'naturopathy'),
      (20100, 'file_opening_couple',              'Ouverture de dossier – couple',                        'fee',       0,   0, false, 'fixed',   3783,  null, 'taxable',    true,  'couple'),
      (20102, 'file_opening_family',              'Ouverture de dossier – famille',                       'fee',       0,   0, false, 'fixed',   3783,  null, 'taxable',    true,  'couple'),
      (20150, 'individual_couple_family_60',      'Consultation individuelle – couple et famille 60 min', 'session',  60,   0, false, 'grid',    null,  60,   'exempt',     true,  'couple'),
      (20160, 'couple_family_60',                 'Consultation couple et famille 60 min',                'session',  60,   0, true,  'grid',    null,  60,   'exempt',     true,  'couple'),
      (20170, 'couple_family_30',                 'Consultation couple et famille 30 min',                'session',  30,   0, true,  'grid',    null,  30,   'taxable',    true,  'couple'),
      (30100, 'file_opening_ivac',                'Ouverture de dossier – IVAC',                          'fee',       0,   0, false, 'fixed',   3783,  null, 'taxable',    true,  'ivac'),
      (30150, 'ivac_50',                          'Consultation IVAC 50 min (part du client)',            'session',  50,  10, false, 'entered', null,  null, 'exempt',     true,  'ivac'),
      (30152, 'ivac_50_reduced',                  'Consultation IVAC 50 min – tarif réduit',              'session',  50,  10, false, 'entered', null,  null, 'exempt',     true,  'ivac'),
      (40130, 'eap_30',                           'PAE externe 30 min',                                   'session',  30,   0, false, 'entered', null,  null, 'exempt',     true,  'eap'),
      (40150, 'eap_50',                           'PAE externe 50 min',                                   'session',  50,  10, false, 'entered', null,  null, 'exempt',     true,  'eap'),
      (40160, 'eap_couple_60',                    'PAE externe – couple 60 min',                          'session',  60,   0, true,  'entered', null,  null, 'exempt',     true,  'eap'),
      (50100, 'waitlist_registration',            'Inscription à la liste d''attente',                    'admin',     0,   0, false, 'fixed',   1891,  null, 'taxable',    true,  'none'),
      (50400, 'report_writing',                   'Rédaction de rapport',                                 'admin',     0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (50401, 'psychometric_test',                'Test psychométrique',                                  'admin',     0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (50500, 'case_discussion',                  'Discussion avec un autre intervenant',                 'admin',     0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (50600, 'file_transfer',                    'Transfert de dossier',                                 'admin',     0,   0, false, 'free',    null,  null, 'exempt',     true,  'none'),
      (50601, 'discovery_call',                   'Appel découverte 15 min',                              'call',     15,   0, false, 'free',    null,  null, 'exempt',     true,  'none'),
      (50602, 'supervision',                      'Supervision',                                          'admin',    60,   0, false, 'entered', null,  null, 'taxable',    true,  'all'),
      (60100, 'workshop_facilitation',            'Atelier – animation',                                  'workshop',  0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (60200, 'workshop_participation',           'Atelier – participation',                              'workshop',  0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (70300, 'late_cancellation_individual',     'Annulation tardive ou absence – individuel',           'fee',       0,   0, false, 'entered', null,  null, 'exempt',     true,  'all'),
      (70360, 'late_cancellation_couple_family',  'Annulation tardive ou absence – couple et famille',    'fee',       0,   0, false, 'entered', null,  null, 'exempt',     true,  'couple'),
      (80100, 'travel_fees',                      'Frais de déplacement',                                 'fee',       0,   0, false, 'entered', null,  null, 'taxable',    true,  'all')
    ) as v(code, key, name, kind, duration, buffer, for_two, source, fixed, grid, tax, active, titles)
  loop
    continue when exists (select 1 from public.services s where s.org_id = p_org and (s.code = r.code or s.key = r.key));
    select f.id into v_family from public.service_families f where f.org_id = p_org and f.code = r.code / 1000;
    continue when v_family is null;

    insert into public.services
      (org_id, family_id, code, key, name, kind, duration_minutes, buffer_after_minutes, for_two,
       price_source, fixed_price_cents, grid_duration, tax_rule, is_active, sort_order)
    values
      (p_org, v_family, r.code, r.key, r.name, r.kind, r.duration, r.buffer, r.for_two,
       r.source, r.fixed, r.grid, r.tax, r.active, r.code)
    returning id into v_service;

    -- The titles that offer it, by group.
    insert into public.service_titles (org_id, service_id, profession_title_id)
    select p_org, v_service, t.id
      from public.profession_titles t
     where t.org_id = p_org
       and case r.titles
             when 'all' then true
             when 'therapy' then t.key in ('psychologue', 'psychotherapeute', 'travailleur_social', 'psychoeducateur', 'sexologue', 'conseiller_orientation', 'coach_professionnel')
             when 'couple' then t.key in ('psychotherapeute', 'travailleur_social', 'psychoeducateur', 'sexologue', 'coach_professionnel')
             when 'ivac' then t.key in ('psychotherapeute', 'travailleur_social', 'psychoeducateur', 'sexologue')
             when 'eap' then t.key in ('psychotherapeute', 'travailleur_social', 'psychoeducateur', 'sexologue', 'conseiller_orientation')
             when 'naturopathy' then t.key = 'naturopathe'
             else false
           end;
  end loop;

  -- Student rates observed for psychologie (visite §18: 96 $ / 120 $), as dated prices per title.
  for r in
    select * from (values ('individual_30', 9600), ('individual_50', 12000)) as v(key, cents)
  loop
    insert into public.service_rate_variants (org_id, service_id, variant, profession_title_id, discount_kind, amount_cents, effective_from)
    select p_org, s.id, 'student', t.id, 'price', r.cents, v_start
      from public.services s
      join public.profession_titles t on t.org_id = s.org_id and t.key = 'psychologue'
     where s.org_id = p_org and s.key = r.key
       and not exists (select 1 from public.service_rate_variants v
                        where v.org_id = p_org and v.service_id = s.id and v.variant = 'student' and v.profession_title_id = t.id);
  end loop;

  -- The signed policy (24 h; 50 % then 100 %), in « confirm » mode (the professional decides,
  -- R-59), with the individual file opening; one open policy per clinic.
  if not exists (select 1 from public.billing_policies b where b.org_id = p_org) then
    select s.id into v_opening from public.services s where s.org_id = p_org and s.key = 'file_opening_individual';
    insert into public.billing_policies (org_id, effective_from, late_notice_hours, first_fee_percent, next_fee_percent, file_opening_service_id, fee_mode)
    values (p_org, v_start, 24, 50, 100, v_opening, 'confirm');
  end if;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_services_catalogue_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_services_catalogue(new.id);
  return null;
end;
$$;

-- « services » sorts after « professionals_reference »: the titles exist when this runs.
create trigger organizations_seed_services_catalogue
  after insert on public.organizations
  for each row execute function private.seed_services_catalogue_on_org();

revoke all on function private.seed_services_catalogue(uuid), private.seed_services_catalogue_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (production).
select private.seed_services_catalogue(o.id) from public.organizations o;
