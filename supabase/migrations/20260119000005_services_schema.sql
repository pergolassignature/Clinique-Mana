-- Migration: services_schema
-- Module: services-catalog
-- Created: 2026-01-19
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)

-- =============================================================================
-- SERVICES TABLE (Core catalog)
-- =============================================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                          -- snake_case identifier
  name text not null,                                -- FR-CA display name
  description_internal text,                         -- Internal notes (staff only)
  default_duration_minutes int not null default 50,
  default_price_cents int not null default 0,        -- Store money in cents
  currency text not null default 'CAD',
  is_active boolean not null default true,           -- Soft delete
  is_bookable_online boolean not null default false, -- Available for online booking
  calendar_color text,                               -- Hex color for calendar view (e.g. '#7FAE9D')
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index services_is_active_idx on public.services(is_active);
create index services_sort_order_idx on public.services(sort_order);
create index services_is_bookable_online_idx on public.services(is_bookable_online);

-- Comments
comment on table public.services is 'Service catalog for the clinic (intake, billing, triage)';
comment on column public.services.key is 'Unique snake_case identifier for the service';
comment on column public.services.default_price_cents is 'Price in cents (e.g. 13000 = $130.00)';
comment on column public.services.calendar_color is 'Hex color for calendar display (e.g. #7FAE9D)';

-- =============================================================================
-- SERVICE_VARIANTS TABLE
-- Avoid duplicating services like "Ouverture de dossier – Couple / Médiation"
-- =============================================================================

create table if not exists public.service_variants (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  key text not null,                                  -- snake_case, unique per service
  label text not null,                               -- FR-CA display label
  duration_minutes_override int,                     -- NULL = use parent duration
  price_cents_override int,                          -- NULL = use parent price
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique key per service
  unique(service_id, key)
);

-- Indexes
create index service_variants_service_id_idx on public.service_variants(service_id);
create index service_variants_is_active_idx on public.service_variants(is_active);

-- Comments
comment on table public.service_variants is 'Variants of a service (e.g. Couple, Médiation for Ouverture de dossier)';
comment on column public.service_variants.duration_minutes_override is 'Override duration, NULL uses parent service duration';
comment on column public.service_variants.price_cents_override is 'Override price in cents, NULL uses parent service price';

-- =============================================================================
-- TAX_RATES TABLE
-- Support TPS/TVQ and future regions
-- =============================================================================

create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                          -- e.g. 'qc_gst', 'qc_qst'
  label text not null,                               -- e.g. 'TPS', 'TVQ'
  rate_bps int not null,                             -- Basis points: 500 = 5.00%, 9975 = 9.975%
  region text,                                       -- e.g. 'QC', 'ON', NULL for federal
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comments
comment on table public.tax_rates is 'Tax rates for invoicing (TPS, TVQ, etc.)';
comment on column public.tax_rates.rate_bps is 'Rate in basis points: 500 = 5.00%, 9975 = 9.975%';

-- =============================================================================
-- SERVICE_TAX_RULES TABLE
-- Define which taxes apply to which services
-- =============================================================================

create table if not exists public.service_tax_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  tax_rate_id uuid references public.tax_rates(id) on delete cascade,  -- NULL = tax exempt rule
  applies boolean not null default true,             -- false = explicitly exempt
  priority int not null default 0,                   -- Order of application
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Prevent duplicate rules
  unique(service_id, tax_rate_id)
);

-- Indexes
create index service_tax_rules_service_id_idx on public.service_tax_rules(service_id);

-- Comments
comment on table public.service_tax_rules is 'Maps services to applicable tax rates';
comment on column public.service_tax_rules.applies is 'false = service is explicitly exempt from this tax';

-- =============================================================================
-- SERVICE_CONSENT_REQUIREMENTS TABLE
-- Define which consent documents are required for each service
-- =============================================================================

create table if not exists public.service_consent_requirements (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  consent_document_key text not null,                -- String reference (consent system TBD)
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One requirement per document per service
  unique(service_id, consent_document_key)
);

-- Indexes
create index service_consent_requirements_service_id_idx on public.service_consent_requirements(service_id);

-- Comments
comment on table public.service_consent_requirements is 'Consent documents required per service';
comment on column public.service_consent_requirements.consent_document_key is 'Reference key for consent document (system TBD)';

-- =============================================================================
-- PROFESSIONAL_SERVICES TABLE
-- Assign which services (and variants) a professional can offer
-- =============================================================================

create table if not exists public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  variant_id uuid references public.service_variants(id) on delete cascade,  -- NULL = all variants
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  -- Prevent duplicates
  primary key (professional_id, service_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Indexes
create index professional_services_professional_id_idx on public.professional_services(professional_id);
create index professional_services_service_id_idx on public.professional_services(service_id);
create index professional_services_variant_id_idx on public.professional_services(variant_id) where variant_id is not null;

-- Comments
comment on table public.professional_services is 'Junction: which services each professional can offer';
comment on column public.professional_services.variant_id is 'NULL = professional can offer all variants of this service';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger services_set_updated_at
  before update on public.services
  for each row
  execute function public.set_updated_at();

create trigger service_variants_set_updated_at
  before update on public.service_variants
  for each row
  execute function public.set_updated_at();

create trigger tax_rates_set_updated_at
  before update on public.tax_rates
  for each row
  execute function public.set_updated_at();

create trigger service_tax_rules_set_updated_at
  before update on public.service_tax_rules
  for each row
  execute function public.set_updated_at();

create trigger service_consent_requirements_set_updated_at
  before update on public.service_consent_requirements
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
alter table public.services enable row level security;
alter table public.service_variants enable row level security;
alter table public.tax_rates enable row level security;
alter table public.service_tax_rules enable row level security;
alter table public.service_consent_requirements enable row level security;
alter table public.professional_services enable row level security;

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

-- SERVICE_VARIANTS: Read for authenticated, write for service_role
create policy "service_variants_select_authenticated"
  on public.service_variants for select
  to authenticated
  using (true);

create policy "service_variants_all_service_role"
  on public.service_variants for all
  to service_role
  using (true)
  with check (true);

-- TAX_RATES: Read for authenticated, write for service_role
create policy "tax_rates_select_authenticated"
  on public.tax_rates for select
  to authenticated
  using (true);

create policy "tax_rates_all_service_role"
  on public.tax_rates for all
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

-- SERVICE_CONSENT_REQUIREMENTS: Read for authenticated, write for service_role
create policy "service_consent_requirements_select_authenticated"
  on public.service_consent_requirements for select
  to authenticated
  using (true);

create policy "service_consent_requirements_all_service_role"
  on public.service_consent_requirements for all
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
