-- Migration: facturation_client_amount
-- Module: facturation
-- Purpose: Add client_amount_cents column to clearly separate invoice total from what client owes
-- Created: 2026-01-24
--
-- Accounting concepts:
-- - total_cents: Full invoice amount (services rendered)
-- - external_payer_amount_cents: Amount covered by IVAC/PAE
-- - client_amount_cents: What the client is responsible for (total - external payer) [NEW]
-- - amount_paid_cents: Payments received from client
-- - balance_cents: What client still owes (client_amount - amount_paid)

-- =============================================================================
-- ADD CLIENT AMOUNT COLUMN
-- =============================================================================

alter table public.invoices
  add column if not exists client_amount_cents int not null default 0;

comment on column public.invoices.client_amount_cents is
  'Amount the client is responsible for (total_cents - external_payer_amount_cents)';

-- =============================================================================
-- UPDATE FUNCTIONS TO MAINTAIN CLIENT AMOUNT
-- =============================================================================

create or replace function public.update_invoice_payer_amount(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payer_total int;
  v_invoice_total int;
  v_amount_paid int;
  v_client_amount int;
begin
  -- Sum all payer allocations for this invoice
  select coalesce(sum(amount_cents), 0)
  into v_payer_total
  from public.invoice_payer_allocations
  where invoice_id = p_invoice_id;

  -- Get current invoice totals
  select total_cents, amount_paid_cents
  into v_invoice_total, v_amount_paid
  from public.invoices
  where id = p_invoice_id;

  -- Calculate client amount (what client is responsible for)
  v_client_amount := v_invoice_total - v_payer_total;

  -- Update the invoice
  -- client_amount = total - payer amount
  -- balance = client_amount - amount_paid
  update public.invoices
  set external_payer_amount_cents = v_payer_total,
      client_amount_cents = v_client_amount,
      balance_cents = v_client_amount - v_amount_paid,
      status = case
        when v_invoice_total = 0 then 'void'
        when v_amount_paid >= v_client_amount then 'paid'
        when v_amount_paid > 0 then 'partial'
        else status
      end,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

-- =============================================================================
-- UPDATE MAIN INVOICE TOTALS RECALCULATION
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
  v_payer_amount int;
  v_client_amount int;
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

  -- Get current external payer amount
  select coalesce(external_payer_amount_cents, 0)
  into v_payer_amount
  from public.invoices
  where id = v_invoice_id;

  -- Calculate client amount
  v_client_amount := v_total - v_payer_amount;

  -- Update invoice
  update public.invoices
  set
    subtotal_cents = v_subtotal,
    discount_cents = v_discount,
    tax_tps_cents = v_tax_tps,
    tax_tvq_cents = v_tax_tvq,
    total_cents = v_total,
    amount_paid_cents = v_paid,
    client_amount_cents = v_client_amount,
    balance_cents = v_client_amount - v_paid,
    status = case
      when v_total = 0 then 'void'
      when v_paid >= v_client_amount then 'paid'
      when v_paid > 0 then 'partial'
      else status
    end,
    updated_at = now()
  where id = v_invoice_id;

  return null;
end;
$$ language plpgsql;

-- =============================================================================
-- DATA FIX: Calculate client_amount_cents for all existing invoices
-- =============================================================================

update public.invoices
set client_amount_cents = total_cents - external_payer_amount_cents
where client_amount_cents = 0 or client_amount_cents is null;
