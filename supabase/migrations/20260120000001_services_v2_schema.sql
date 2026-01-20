-- Migration: services_v2_schema
-- Module: services-catalog
-- Created: 2026-01-20
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- This migration replaces the initial services schema with a more robust,
-- business-aligned structure supporting multiple pricing models.
--
-- BREAKING CHANGE: Drops and recreates services-related tables.
-- Safe on staging where no production data exists.

-- =============================================================================
-- DROP PREVIOUS SERVICES TABLES (if they exist)
-- Order matters due to FK constraints
-- =============================================================================

drop table if exists public.professional_services cascade;
drop table if exists public.service_consent_requirements cascade;
drop table if exists public.service_tax_rules cascade;
drop table if exists public.service_variants cascade;
drop table if exists public.services cascade;
-- Keep tax_rates - it's still valid and useful

-- =============================================================================
-- PROFESSION_CATEGORIES TABLE
-- Categories like psychologie, psychothérapie, travail_social, etc.
-- =============================================================================

create table if not exists public.profession_categories (
  key text primary key,
  label_fr text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profession_categories is 'Profession categories that determine pricing (psychologie, sexologie, etc.)';
comment on column public.profession_categories.key is 'snake_case identifier, e.g. psychologie';

-- =============================================================================
-- PROFESSION_TITLES TABLE
-- Titles like psychologue, psychothérapeute, etc. mapped to categories
-- =============================================================================

create table if not exists public.profession_titles (
  key text primary key,
  label_fr text not null,
  profession_category_key text not null references public.profession_categories(key) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profession_titles_category_idx on public.profession_titles(profession_category_key);

comment on table public.profession_titles is 'Professional titles mapped to categories (psychologue → psychologie)';
comment on column public.profession_titles.profession_category_key is 'FK to profession_categories determining pricing tier';

-- =============================================================================
-- SERVICES TABLE (Redesigned)
-- Core service catalog with pricing model support
-- =============================================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name_fr text not null,
  description_fr text,

  -- Pricing model determines how price is calculated
  pricing_model text not null check (pricing_model in (
    'fixed',                        -- Global fixed price (e.g., Ouverture de dossier)
    'by_profession_category',       -- Price varies by profession category + duration
    'rule_cancellation_prorata',    -- Derived from cancelled service if <24h
    'by_profession_hourly_prorata'  -- Minute-based at hourly rate (reports, discussions)
  )),

  -- Duration (NULL for services without fixed duration like report writing)
  default_duration_minutes int,

  -- Display & organization
  display_order int not null default 0,
  color_hex text,  -- For calendar display later (e.g., '#7FAE9D')

  -- Flags
  is_active boolean not null default true,
  requires_consent boolean not null default false,  -- Placeholder for consent system

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_is_active_idx on public.services(is_active);
create index services_display_order_idx on public.services(display_order);
create index services_pricing_model_idx on public.services(pricing_model);

comment on table public.services is 'Service catalog with multi-model pricing support';
comment on column public.services.pricing_model is 'Determines price calculation: fixed, by_profession_category, rule_cancellation_prorata, by_profession_hourly_prorata';
comment on column public.services.color_hex is 'Hex color for future calendar display';
comment on column public.services.requires_consent is 'Placeholder: true if service requires client consent document';

-- =============================================================================
-- SERVICE_PRICES TABLE
-- Fixed prices for 'fixed' and 'by_profession_category' models
-- =============================================================================

create table if not exists public.service_prices (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,

  -- NULL profession_category_key = global price (for 'fixed' model)
  -- Non-NULL = price for that profession category
  profession_category_key text references public.profession_categories(key) on delete restrict,

  -- Duration variant (NULL for standard duration, or specific minutes for variants)
  duration_minutes int,

  price_cents int not null,
  currency text not null default 'CAD',
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique constraint: one price per service+category+duration combination
  unique(service_id, profession_category_key, duration_minutes)
);

create index service_prices_service_id_idx on public.service_prices(service_id);
create index service_prices_category_idx on public.service_prices(profession_category_key);
create index service_prices_is_active_idx on public.service_prices(is_active);

comment on table public.service_prices is 'Fixed prices for services (global or per profession category)';
comment on column public.service_prices.profession_category_key is 'NULL = global price, otherwise price for specific profession category';
comment on column public.service_prices.duration_minutes is 'NULL = default duration, or specific duration variant (30, 50, 60, 90 min)';
comment on column public.service_prices.price_cents is 'Price in cents (e.g., 13000 = $130.00)';

-- =============================================================================
-- PROFESSION_CATEGORY_RATES TABLE
-- Hourly rates for minute-based billing (report writing, discussions)
-- =============================================================================

create table if not exists public.profession_category_rates (
  id uuid primary key default gen_random_uuid(),
  profession_category_key text unique not null references public.profession_categories(key) on delete restrict,
  hourly_rate_cents int not null,
  currency text not null default 'CAD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profession_category_rates is 'Hourly rates per profession category for minute-based billing';
comment on column public.profession_category_rates.hourly_rate_cents is 'Hourly rate in cents. For minute billing: (minutes/60) * hourly_rate_cents';

-- =============================================================================
-- SERVICE_RULES TABLE
-- Rules for special pricing models (e.g., cancellation prorata)
-- =============================================================================

create table if not exists public.service_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  rule_type text not null check (rule_type in ('cancellation_prorata')),
  params jsonb not null default '{}',  -- e.g., {"threshold_hours": 24}
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One rule per type per service
  unique(service_id, rule_type)
);

create index service_rules_service_id_idx on public.service_rules(service_id);

comment on table public.service_rules is 'Special pricing rules (e.g., cancellation fee threshold)';
comment on column public.service_rules.rule_type is 'Rule type: cancellation_prorata';
comment on column public.service_rules.params is 'Rule parameters as JSON, e.g., {"threshold_hours": 24}';

-- =============================================================================
-- SERVICE_TAX_RULES TABLE (Recreated)
-- Which taxes apply to which services
-- =============================================================================

create table if not exists public.service_tax_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  tax_rate_id uuid references public.tax_rates(id) on delete cascade,
  applies boolean not null default true,  -- false = explicitly exempt
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(service_id, tax_rate_id)
);

create index service_tax_rules_service_id_idx on public.service_tax_rules(service_id);

comment on table public.service_tax_rules is 'Service-to-tax mapping (which taxes apply to which services)';
comment on column public.service_tax_rules.applies is 'false = service is explicitly exempt from this tax';

-- =============================================================================
-- PROFESSIONAL_PROFESSIONS TABLE
-- Links professionals to their profession titles (1-2 per professional)
-- =============================================================================

create table if not exists public.professional_professions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  profession_title_key text not null references public.profession_titles(key) on delete restrict,
  license_number text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One profession title per professional (max 2 rows enforced at app level)
  unique(professional_id, profession_title_key)
);

create index professional_professions_professional_idx on public.professional_professions(professional_id);
create index professional_professions_title_idx on public.professional_professions(profession_title_key);

comment on table public.professional_professions is 'Junction: professionals ↔ profession titles (1-2 per professional with license numbers)';
comment on column public.professional_professions.is_primary is 'true = primary profession for this professional';
comment on column public.professional_professions.license_number is 'License/permit number for this specific profession';

-- =============================================================================
-- PROFESSIONAL_SERVICES TABLE
-- Which services each professional offers (for future assignment)
-- =============================================================================

create table if not exists public.professional_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(professional_id, service_id)
);

create index professional_services_professional_idx on public.professional_services(professional_id);
create index professional_services_service_idx on public.professional_services(service_id);

comment on table public.professional_services is 'Junction: which services each professional can offer';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger profession_categories_set_updated_at
  before update on public.profession_categories
  for each row
  execute function public.set_updated_at();

create trigger profession_titles_set_updated_at
  before update on public.profession_titles
  for each row
  execute function public.set_updated_at();

create trigger services_set_updated_at
  before update on public.services
  for each row
  execute function public.set_updated_at();

create trigger service_prices_set_updated_at
  before update on public.service_prices
  for each row
  execute function public.set_updated_at();

create trigger profession_category_rates_set_updated_at
  before update on public.profession_category_rates
  for each row
  execute function public.set_updated_at();

create trigger service_rules_set_updated_at
  before update on public.service_rules
  for each row
  execute function public.set_updated_at();

create trigger service_tax_rules_set_updated_at
  before update on public.service_tax_rules
  for each row
  execute function public.set_updated_at();

create trigger professional_professions_set_updated_at
  before update on public.professional_professions
  for each row
  execute function public.set_updated_at();

create trigger professional_services_set_updated_at
  before update on public.professional_services
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.profession_categories enable row level security;
alter table public.profession_titles enable row level security;
alter table public.services enable row level security;
alter table public.service_prices enable row level security;
alter table public.profession_category_rates enable row level security;
alter table public.service_rules enable row level security;
alter table public.service_tax_rules enable row level security;
alter table public.professional_professions enable row level security;
alter table public.professional_services enable row level security;

-- PROFESSION_CATEGORIES: Read for authenticated, write for service_role
create policy "profession_categories_select_authenticated"
  on public.profession_categories for select
  to authenticated
  using (true);

create policy "profession_categories_all_service_role"
  on public.profession_categories for all
  to service_role
  using (true)
  with check (true);

-- PROFESSION_TITLES: Read for authenticated, write for service_role
create policy "profession_titles_select_authenticated"
  on public.profession_titles for select
  to authenticated
  using (true);

create policy "profession_titles_all_service_role"
  on public.profession_titles for all
  to service_role
  using (true)
  with check (true);

-- SERVICES: Read for authenticated, write for service_role
create policy "services_select_authenticated"
  on public.services for select
  to authenticated
  using (true);

create policy "services_all_service_role"
  on public.services for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_PRICES: Read for authenticated, write for service_role
create policy "service_prices_select_authenticated"
  on public.service_prices for select
  to authenticated
  using (true);

create policy "service_prices_all_service_role"
  on public.service_prices for all
  to service_role
  using (true)
  with check (true);

-- PROFESSION_CATEGORY_RATES: Read for authenticated, write for service_role
create policy "profession_category_rates_select_authenticated"
  on public.profession_category_rates for select
  to authenticated
  using (true);

create policy "profession_category_rates_all_service_role"
  on public.profession_category_rates for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_RULES: Read for authenticated, write for service_role
create policy "service_rules_select_authenticated"
  on public.service_rules for select
  to authenticated
  using (true);

create policy "service_rules_all_service_role"
  on public.service_rules for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_TAX_RULES: Read for authenticated, write for service_role
create policy "service_tax_rules_select_authenticated"
  on public.service_tax_rules for select
  to authenticated
  using (true);

create policy "service_tax_rules_all_service_role"
  on public.service_tax_rules for all
  to service_role
  using (true)
  with check (true);

-- PROFESSIONAL_PROFESSIONS: Read for authenticated, write for service_role
create policy "professional_professions_select_authenticated"
  on public.professional_professions for select
  to authenticated
  using (true);

create policy "professional_professions_all_service_role"
  on public.professional_professions for all
  to service_role
  using (true)
  with check (true);

-- PROFESSIONAL_SERVICES: Read for authenticated, write for service_role
create policy "professional_services_select_authenticated"
  on public.professional_services for select
  to authenticated
  using (true);

create policy "professional_services_all_service_role"
  on public.professional_services for all
  to service_role
  using (true)
  with check (true);
