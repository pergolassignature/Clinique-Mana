-- Migration: facturation_schema
-- Module: facturation
-- Gate: 1 — Core Tables
-- Created: 2026-01-23

-- =============================================================================
-- INVOICES TABLE
-- Core invoice records linked to appointments
-- =============================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),

  -- Display ID (human-readable, auto-generated)
  invoice_number text unique not null, -- Format: INV-2026-000001

  -- Links
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,

  -- Invoice dates
  invoice_date date not null default current_date,
  due_date date,

  -- Status workflow
  status text not null default 'draft' check (status in (
    'draft',     -- Created but not finalized
    'pending',   -- Finalized, awaiting payment
    'partial',   -- Partially paid
    'paid',      -- Fully paid
    'void'       -- Cancelled/voided
  )),

  -- Totals in cents (denormalized for performance, updated by triggers)
  subtotal_cents int not null default 0,
  discount_cents int not null default 0,
  tax_tps_cents int not null default 0,
  tax_tvq_cents int not null default 0,
  total_cents int not null default 0,
  amount_paid_cents int not null default 0,
  balance_cents int not null default 0, -- total - amount_paid

  -- External payer allocation (not invoiced to client, tracked separately)
  external_payer_amount_cents int not null default 0,

  -- QuickBooks sync (for Phase B)
  qbo_invoice_id text,
  qbo_invoice_number text,
  qbo_sync_status text check (qbo_sync_status in (
    'pending', 'synced', 'error', 'not_applicable'
  )) default 'pending',
  qbo_sync_error text,
  qbo_synced_at timestamptz,

  -- Notes
  notes_internal text,   -- Staff-only notes
  notes_client text,     -- Visible on invoice

  -- Metadata
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoices is 'Invoice records for billing appointments';
comment on column public.invoices.invoice_number is 'Human-readable ID: INV-2026-000001 format';
comment on column public.invoices.balance_cents is 'Amount remaining to be paid (total - amount_paid)';
comment on column public.invoices.external_payer_amount_cents is 'Amount covered by external payers (IVAC/PAE), not invoiced to client';
comment on column public.invoices.qbo_sync_status is 'QuickBooks sync status: pending, synced, error, not_applicable';

-- =============================================================================
-- SEQUENCE FOR INVOICE_NUMBER
-- Auto-generate INV-2026-000001, INV-2026-000002, etc.
-- =============================================================================

create sequence public.invoices_invoice_number_seq start 1;

create or replace function public.generate_invoice_number()
returns trigger as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(current_date, 'YYYY') || '-' ||
                          lpad(nextval('public.invoices_invoice_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger invoices_generate_invoice_number
  before insert on public.invoices
  for each row
  execute function public.generate_invoice_number();

-- =============================================================================
-- INVOICE INDEXES
-- =============================================================================

create index invoices_invoice_number_idx on public.invoices(invoice_number);
create index invoices_appointment_id_idx on public.invoices(appointment_id);
create index invoices_client_id_idx on public.invoices(client_id);
create index invoices_professional_id_idx on public.invoices(professional_id);
create index invoices_status_idx on public.invoices(status);
create index invoices_invoice_date_idx on public.invoices(invoice_date);
create index invoices_created_at_idx on public.invoices(created_at);

-- Partial index for unpaid invoices
create index invoices_unpaid_idx on public.invoices(client_id, balance_cents)
  where status in ('pending', 'partial') and balance_cents > 0;

-- =============================================================================
-- INVOICE_LINE_ITEMS TABLE
-- Individual line items on an invoice
-- =============================================================================

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,

  -- Line item type
  line_type text not null check (line_type in (
    'service',           -- Standard service from catalog
    'cancellation_fee',  -- Cancellation fee
    'file_opening_fee',  -- Ouverture de dossier
    'adjustment',        -- Manual adjustment
    'discount'           -- Discount line
  )),

  -- Service reference (snapshot at invoice time)
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,      -- Frozen service name
  service_key_snapshot text,                -- For reconciliation

  -- Quantity (for minute-based billing)
  quantity_unit text not null default 'unit' check (quantity_unit in ('unit', 'minute', 'hour')),
  quantity numeric(10,2) not null default 1, -- 1 for fixed, or minutes for prorata
  billable_minutes int,                      -- For minute-based services

  -- Pricing (snapshot at invoice time)
  unit_price_cents int not null,             -- Pre-tax unit price
  profession_category_key_snapshot text,     -- Which category rate was used

  -- Discount on this line
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2),              -- Percent (0-100) or cents
  discount_cents int not null default 0,     -- Calculated discount amount

  -- Tax (snapshot at invoice time)
  is_taxable boolean not null default false,
  tax_tps_rate_snapshot numeric(6,4),        -- 0.05 for 5%
  tax_tvq_rate_snapshot numeric(6,4),        -- 0.09975 for 9.975%
  tax_tps_cents int not null default 0,
  tax_tvq_cents int not null default 0,

  -- Totals
  subtotal_cents int not null,               -- quantity * unit_price - discount
  total_cents int not null,                  -- subtotal + taxes

  -- Display
  display_order int not null default 0,
  description text,                          -- Additional line description

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoice_line_items is 'Individual line items on an invoice';
comment on column public.invoice_line_items.service_name_snapshot is 'Frozen service name at invoice time';
comment on column public.invoice_line_items.quantity_unit is 'Unit of quantity: unit (1), minute, hour';
comment on column public.invoice_line_items.billable_minutes is 'For minute-based services, the number of minutes billed';
comment on column public.invoice_line_items.is_taxable is 'Whether this line item is taxable (TPS+TVQ)';

-- =============================================================================
-- INVOICE_LINE_ITEMS INDEXES
-- =============================================================================

create index invoice_line_items_invoice_id_idx on public.invoice_line_items(invoice_id);
create index invoice_line_items_service_id_idx on public.invoice_line_items(service_id) where service_id is not null;
create index invoice_line_items_line_type_idx on public.invoice_line_items(line_type);

-- =============================================================================
-- INVOICE_PAYMENTS TABLE
-- Payment records for invoices
-- =============================================================================

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,

  -- Payment details
  amount_cents int not null check (amount_cents > 0),
  payment_date date not null default current_date,
  payment_method text check (payment_method in (
    'cash', 'debit', 'credit', 'etransfer', 'cheque', 'other'
  )),

  -- Reference numbers
  reference_number text,

  -- QuickBooks sync (for Phase B)
  qbo_payment_id text,
  qbo_synced_at timestamptz,

  -- Source of payment record
  source text not null default 'manual' check (source in (
    'manual',      -- Entered by staff
    'qbo_webhook', -- From QuickBooks webhook
    'qbo_sync'     -- From QBO sync
  )),

  notes text,

  -- Audit
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

comment on table public.invoice_payments is 'Payment records for invoices';
comment on column public.invoice_payments.source is 'Source of payment: manual entry, QBO webhook, or QBO sync';

-- =============================================================================
-- INVOICE_PAYMENTS INDEXES
-- =============================================================================

create index invoice_payments_invoice_id_idx on public.invoice_payments(invoice_id);
create index invoice_payments_payment_date_idx on public.invoice_payments(payment_date);
create index invoice_payments_created_at_idx on public.invoice_payments(created_at);

-- =============================================================================
-- INVOICE_PAYER_ALLOCATIONS TABLE
-- External payer (IVAC/PAE) allocations for invoices
-- =============================================================================

create table public.invoice_payer_allocations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,

  -- Link to client's payer record
  client_external_payer_id uuid not null references public.client_external_payers(id) on delete restrict,
  payer_type text not null check (payer_type in ('ivac', 'pae')),

  -- Allocation amount
  amount_cents int not null check (amount_cents > 0),

  -- For IVAC: fixed rate tracking
  ivac_rate_applied_cents int,  -- $94.50 = 9450

  -- For PAE: coverage rule applied
  pae_rule_type_applied text,   -- 'free_appointments', 'shared_cost', etc.
  pae_percentage_applied int,   -- If shared_cost rule

  -- Status tracking for reporting
  status text not null default 'pending' check (status in (
    'pending',   -- Allocated, not yet reported
    'reported',  -- Included in payer report
    'paid'       -- Payment received from payer
  )),

  reported_at timestamptz,
  paid_at timestamptz,

  notes text,
  created_at timestamptz not null default now()
);

comment on table public.invoice_payer_allocations is 'External payer allocations (IVAC/PAE) for invoices';
comment on column public.invoice_payer_allocations.status is 'Status: pending (allocated), reported (in report), paid (received)';
comment on column public.invoice_payer_allocations.ivac_rate_applied_cents is 'IVAC fixed rate applied: $94.50 = 9450 cents';
comment on column public.invoice_payer_allocations.pae_rule_type_applied is 'PAE coverage rule that was applied';

-- =============================================================================
-- INVOICE_PAYER_ALLOCATIONS INDEXES
-- =============================================================================

create index invoice_payer_allocations_invoice_id_idx on public.invoice_payer_allocations(invoice_id);
create index invoice_payer_allocations_payer_id_idx on public.invoice_payer_allocations(client_external_payer_id);
create index invoice_payer_allocations_status_idx on public.invoice_payer_allocations(status);
create index invoice_payer_allocations_payer_type_idx on public.invoice_payer_allocations(payer_type);

-- Partial index for pending allocations (for reporting)
create index invoice_payer_allocations_pending_idx
  on public.invoice_payer_allocations(payer_type, created_at)
  where status = 'pending';

-- =============================================================================
-- INVOICE_AUDIT_LOG TABLE
-- Immutable audit trail for invoice changes
-- =============================================================================

create table public.invoice_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Reference
  invoice_id uuid not null references public.invoices(id) on delete cascade,

  -- Actor
  actor_id uuid references public.profiles(id),

  -- Action
  action text not null check (action in (
    'created',
    'line_added',
    'line_updated',
    'line_removed',
    'discount_applied',
    'finalized',
    'payment_recorded',
    'payment_removed',
    'synced_to_qbo',
    'sync_failed',
    'voided',
    'payer_allocated',
    'payer_reported',
    'payer_paid',
    'updated'
  )),

  -- State
  old_value jsonb,
  new_value jsonb,

  -- Context (denormalized for display)
  context jsonb,

  created_at timestamptz not null default now()
);

comment on table public.invoice_audit_log is 'Append-only audit log for invoice changes';
comment on column public.invoice_audit_log.context is 'Denormalized context: line_item_id, payment_id, etc.';

-- =============================================================================
-- INVOICE_AUDIT_LOG INDEXES
-- =============================================================================

create index invoice_audit_log_invoice_id_idx on public.invoice_audit_log(invoice_id);
create index invoice_audit_log_action_idx on public.invoice_audit_log(action);
create index invoice_audit_log_created_at_idx on public.invoice_audit_log(created_at);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row
  execute function public.set_updated_at();

create trigger invoice_line_items_set_updated_at
  before update on public.invoice_line_items
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- INVOICE TOTALS RECALCULATION FUNCTION
-- Updates invoice totals when line items or payments change
-- =============================================================================

create or replace function public.recalculate_invoice_totals()
returns trigger
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_subtotal int;
  v_discount int;
  v_tax_tps int;
  v_tax_tvq int;
  v_total int;
  v_paid int;
begin
  -- Determine which invoice to recalculate
  if tg_table_name = 'invoice_line_items' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  elsif tg_table_name = 'invoice_payments' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  else
    return null;
  end if;

  -- Calculate line item totals
  select
    coalesce(sum(subtotal_cents + discount_cents), 0),
    coalesce(sum(discount_cents), 0),
    coalesce(sum(tax_tps_cents), 0),
    coalesce(sum(tax_tvq_cents), 0),
    coalesce(sum(total_cents), 0)
  into v_subtotal, v_discount, v_tax_tps, v_tax_tvq, v_total
  from public.invoice_line_items
  where invoice_id = v_invoice_id;

  -- Calculate payments total
  select coalesce(sum(amount_cents), 0)
  into v_paid
  from public.invoice_payments
  where invoice_id = v_invoice_id;

  -- Update invoice
  update public.invoices
  set
    subtotal_cents = v_subtotal,
    discount_cents = v_discount,
    tax_tps_cents = v_tax_tps,
    tax_tvq_cents = v_tax_tvq,
    total_cents = v_total,
    amount_paid_cents = v_paid,
    balance_cents = v_total - v_paid,
    status = case
      when v_total = 0 then 'void'
      when v_paid >= v_total then 'paid'
      when v_paid > 0 then 'partial'
      else status -- Keep current status if no payments
    end,
    updated_at = now()
  where id = v_invoice_id;

  return null;
end;
$$ language plpgsql;

-- Trigger on line items
create trigger invoice_line_items_recalculate_totals
  after insert or update or delete on public.invoice_line_items
  for each row
  execute function public.recalculate_invoice_totals();

-- Trigger on payments
create trigger invoice_payments_recalculate_totals
  after insert or update or delete on public.invoice_payments
  for each row
  execute function public.recalculate_invoice_totals();

-- =============================================================================
-- CLIENT BALANCE RECALCULATION FUNCTION
-- Updates client balance when invoice totals change
-- =============================================================================

create or replace function public.recalculate_client_balance()
returns trigger
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_balance int;
begin
  -- Determine which client to recalculate
  v_client_id := coalesce(new.client_id, old.client_id);

  -- Calculate total balance across all non-void invoices
  -- Negative = client owes money, Positive = client has credit
  select coalesce(sum(-balance_cents), 0)
  into v_balance
  from public.invoices
  where client_id = v_client_id
    and status != 'void';

  -- Update client balance
  update public.clients
  set balance_cents = v_balance
  where id = v_client_id;

  return null;
end;
$$ language plpgsql;

-- Trigger on invoices for balance update
create trigger invoices_recalculate_client_balance
  after insert or update or delete on public.invoices
  for each row
  execute function public.recalculate_client_balance();
