-- Migration: external_payers_schema
-- Module: external-payers
-- Gate: 2 — Schema
-- Created: 2026-01-21

-- =============================================================================
-- CLINIC SETTINGS TABLE (single-row)
-- Clinic-wide configuration settings
-- =============================================================================

create table public.clinic_settings (
  id uuid primary key default gen_random_uuid(),

  -- IVAC settings
  ivac_provider_number text, -- Numéro de fournisseur de la clinique

  -- Future: other clinic-level settings can be added here

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Enforce single row via fixed ID constraint
  constraint clinic_settings_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

-- Insert the singleton row
insert into public.clinic_settings (id) values ('00000000-0000-0000-0000-000000000001');

comment on table public.clinic_settings is 'Single-row table for clinic-wide configuration';
comment on column public.clinic_settings.ivac_provider_number is 'IVAC clinic provider registration number';

-- =============================================================================
-- PROFESSIONAL IVAC NUMBERS TABLE
-- Each professional registered with IVAC has a unique number
-- =============================================================================

create table public.professional_ivac_numbers (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  ivac_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Only one IVAC number per professional
  constraint professional_ivac_numbers_professional_unique unique(professional_id),
  -- Prevent duplicate IVAC numbers across professionals
  constraint professional_ivac_numbers_number_unique unique(ivac_number)
);

create index professional_ivac_numbers_professional_id_idx on public.professional_ivac_numbers(professional_id);

comment on table public.professional_ivac_numbers is 'IVAC registration numbers for professionals';
comment on column public.professional_ivac_numbers.ivac_number is 'Unique IVAC number assigned to this professional';

-- =============================================================================
-- CLIENT EXTERNAL PAYERS (base table)
-- Links clients to external payer programs (IVAC, PAE)
-- =============================================================================

create table public.client_external_payers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  payer_type text not null check (payer_type in ('ivac', 'pae')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique index: only one active payer per type per client
create unique index client_external_payers_active_unique
  on public.client_external_payers(client_id, payer_type)
  where is_active = true;

create index client_external_payers_client_id_idx on public.client_external_payers(client_id);
create index client_external_payers_payer_type_idx on public.client_external_payers(payer_type);
create index client_external_payers_is_active_idx on public.client_external_payers(is_active);

comment on table public.client_external_payers is 'Base table linking clients to external payer programs';
comment on column public.client_external_payers.payer_type is 'Type of payer: ivac, pae';
comment on column public.client_external_payers.is_active is 'Whether this payer is currently active for the client';

-- =============================================================================
-- CLIENT PAYER IVAC (IVAC-specific details)
-- =============================================================================

create table public.client_payer_ivac (
  payer_id uuid primary key references public.client_external_payers(id) on delete cascade,
  file_number text not null, -- Numéro de dossier client
  event_date date, -- Date de l'événement (optional)
  expiry_date date, -- Date limite/expiration (optional)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- IVAC dossier number should not be duplicated
  constraint client_payer_ivac_file_number_unique unique(file_number)
);

comment on table public.client_payer_ivac is 'IVAC-specific payer details';
comment on column public.client_payer_ivac.file_number is 'IVAC dossier number';
comment on column public.client_payer_ivac.event_date is 'Date of the event that caused the claim';
comment on column public.client_payer_ivac.expiry_date is 'Expiry date for IVAC coverage';
-- Note: IVAC fixed rate of $94.50 per appointment is stored as constant in code, not in DB

-- =============================================================================
-- CLIENT PAYER PAE (PAE-specific details)
-- =============================================================================

create table public.client_payer_pae (
  payer_id uuid primary key references public.client_external_payers(id) on delete cascade,
  file_number text not null, -- Numéro de dossier client
  employer_name text, -- Nom de l'employeur
  pae_provider_name text not null, -- Fournisseur PAE (ex: Morneau Shepell)
  file_opening_fee boolean not null default false, -- Frais d'ouverture de dossier inclus
  reimbursement_percentage integer not null check (reimbursement_percentage >= 0 and reimbursement_percentage <= 100),
  maximum_amount_cents integer not null check (maximum_amount_cents >= 0), -- Montant maximum en cents
  expiry_date date not null, -- Date limite/expiration (required)

  -- Coverage rules as flexible JSONB array
  coverage_rules jsonb not null default '[]'::jsonb,

  -- Budget tracking for future invoicing
  appointments_used integer not null default 0 check (appointments_used >= 0),
  amount_used_cents integer not null default 0 check (amount_used_cents >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Prevent duplicates: same PAE provider + file number should be unique
  constraint client_payer_pae_provider_file_unique unique(pae_provider_name, file_number),
  -- Ensure coverage_rules is an array
  constraint client_payer_pae_coverage_rules_array check (jsonb_typeof(coverage_rules) = 'array')
);

comment on table public.client_payer_pae is 'PAE (Employee Assistance Program) specific payer details';
comment on column public.client_payer_pae.file_number is 'PAE dossier number';
comment on column public.client_payer_pae.employer_name is 'Name of the employer providing PAE';
comment on column public.client_payer_pae.pae_provider_name is 'Name of PAE provider (e.g., Morneau Shepell)';
comment on column public.client_payer_pae.file_opening_fee is 'Whether file opening fee is included';
comment on column public.client_payer_pae.reimbursement_percentage is 'Percentage reimbursed by PAE (0-100)';
comment on column public.client_payer_pae.maximum_amount_cents is 'Maximum coverage amount in cents';
comment on column public.client_payer_pae.expiry_date is 'Expiry date for PAE coverage';
comment on column public.client_payer_pae.coverage_rules is 'JSONB array of coverage rules for computing deductions';
comment on column public.client_payer_pae.appointments_used is 'Number of appointments used (for budget tracking)';
comment on column public.client_payer_pae.amount_used_cents is 'Amount used in cents (for budget tracking)';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger clinic_settings_set_updated_at
  before update on public.clinic_settings
  for each row
  execute function public.set_updated_at();

create trigger professional_ivac_numbers_set_updated_at
  before update on public.professional_ivac_numbers
  for each row
  execute function public.set_updated_at();

create trigger client_external_payers_set_updated_at
  before update on public.client_external_payers
  for each row
  execute function public.set_updated_at();

create trigger client_payer_ivac_set_updated_at
  before update on public.client_payer_ivac
  for each row
  execute function public.set_updated_at();

create trigger client_payer_pae_set_updated_at
  before update on public.client_payer_pae
  for each row
  execute function public.set_updated_at();
