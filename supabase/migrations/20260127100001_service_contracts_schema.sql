-- ============================================================================
-- SERVICE CONTRACTS MODULE
-- ============================================================================
-- Tracks service contract generation, sending, and electronic signing
-- for professionals joining Clinique MANA
-- ============================================================================

-- Service contracts tracking table
create table public.service_contracts (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,

  -- Contract version tracking (increments when new contract generated)
  version int not null default 1,

  -- Status workflow: draft → sent → signed (or expired/superseded)
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'expired', 'superseded')),

  -- Token for magic link signing (64 hex characters)
  token text unique not null,

  -- Timestamps for lifecycle tracking
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz not null,

  -- Who generated this contract
  generated_by uuid references public.profiles(id),

  -- Storage paths for PDFs
  draft_pdf_path text,
  signed_pdf_path text,

  -- Signing details (populated when signed)
  signed_city text,
  signed_date date,
  signature_base64 text,

  -- Snapshots of data at generation time (immutable record)
  professional_snapshot jsonb not null,
  pricing_snapshot jsonb not null,

  -- Standard timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contract page initials (one per page, pages 1-9)
create table public.contract_initials (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  page_number int not null check (page_number between 1 and 9),
  initials_base64 text not null,
  created_at timestamptz not null default now(),

  unique(contract_id, page_number)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index service_contracts_professional_idx
  on public.service_contracts(professional_id);

create index service_contracts_token_idx
  on public.service_contracts(token);

create index service_contracts_status_idx
  on public.service_contracts(status);

create index contract_initials_contract_idx
  on public.contract_initials(contract_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
create trigger service_contracts_set_updated_at
  before update on public.service_contracts
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.service_contracts enable row level security;
alter table public.contract_initials enable row level security;

-- Admin/staff can read all contracts
create policy "service_contracts_select_authenticated"
  on public.service_contracts for select
  to authenticated
  using (true);

-- Admin/staff can insert contracts
create policy "service_contracts_insert_staff"
  on public.service_contracts for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
      and profiles.role in ('admin', 'staff')
    )
  );

-- Admin/staff can update contracts
create policy "service_contracts_update_staff"
  on public.service_contracts for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
      and profiles.role in ('admin', 'staff')
    )
  );

-- Anon can read contract by valid token (for signing page)
create policy "service_contracts_select_by_token_anon"
  on public.service_contracts for select
  to anon
  using (
    token is not null
    and status = 'sent'
    and expires_at > now()
  );

-- Anon can update contract to signed (limited fields via Edge Function)
create policy "service_contracts_update_anon_sign"
  on public.service_contracts for update
  to anon
  using (
    token is not null
    and status = 'sent'
    and expires_at > now()
  )
  with check (status = 'signed');

-- Contract initials policies

-- Admin/staff can read all initials
create policy "contract_initials_select_authenticated"
  on public.contract_initials for select
  to authenticated
  using (true);

-- Anon can insert initials for contracts being signed
create policy "contract_initials_insert_anon"
  on public.contract_initials for insert
  to anon
  with check (
    exists (
      select 1 from public.service_contracts
      where service_contracts.id = contract_initials.contract_id
      and service_contracts.status = 'sent'
      and service_contracts.expires_at > now()
    )
  );

-- Anon can read initials for contracts they're signing
create policy "contract_initials_select_anon"
  on public.contract_initials for select
  to anon
  using (
    exists (
      select 1 from public.service_contracts
      where service_contracts.id = contract_initials.contract_id
      and service_contracts.status = 'sent'
      and service_contracts.expires_at > now()
    )
  );

-- ============================================================================
-- EXTEND DOCUMENT TYPES
-- ============================================================================

-- Add 'service_contract' to the document_type check constraint
-- First drop the existing constraint, then add the updated one
alter table public.professional_documents
  drop constraint if exists professional_documents_document_type_check;

alter table public.professional_documents
  add constraint professional_documents_document_type_check
  check (document_type in ('cv', 'diploma', 'license', 'insurance', 'photo', 'fiche', 'service_contract', 'other'));

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on table public.service_contracts is
  'Tracks service contract generation, sending, and electronic signing for professionals';

comment on column public.service_contracts.token is
  '64-character hex token for magic link signing';

comment on column public.service_contracts.professional_snapshot is
  'Frozen copy of professional data at contract generation time';

comment on column public.service_contracts.pricing_snapshot is
  'Frozen copy of pricing data at contract generation time';

comment on table public.contract_initials is
  'Stores initials drawn by professional on each contract page';
