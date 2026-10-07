-- Migration: facturation_balance_includes_payer
-- Module: facturation
-- Purpose: Update balance calculation to include external payer amounts
-- Created: 2026-01-24
--
-- Problem: balance_cents = total_cents - amount_paid_cents
--          but should be: balance_cents = total_cents - amount_paid_cents - external_payer_amount_cents
--
-- This ensures the correct balance is sent to QuickBooks (client only pays their portion)

-- =============================================================================
-- FIX: Update the invoice payer amount function to also recalculate balance
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

  -- Update the invoice with new payer amount and recalculated balance
  -- Balance = Total - Paid - External Payer Amount
  update public.invoices
  set external_payer_amount_cents = v_payer_total,
      balance_cents = v_invoice_total - v_amount_paid - v_payer_total,
      -- Update status based on new balance
      status = case
        when v_invoice_total = 0 then 'void'
        when v_amount_paid >= (v_invoice_total - v_payer_total) then 'paid'
        when v_amount_paid > 0 then 'partial'
        else status
      end,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

comment on function public.update_invoice_payer_amount(uuid) is
  'Updates external_payer_amount_cents and recalculates balance_cents to exclude payer coverage';

-- =============================================================================
-- FIX: Update the main invoice totals recalculation function
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

  -- Update invoice
  -- Balance = Total - Paid - External Payer Amount
  update public.invoices
  set
    subtotal_cents = v_subtotal,
    discount_cents = v_discount,
    tax_tps_cents = v_tax_tps,
    tax_tvq_cents = v_tax_tvq,
    total_cents = v_total,
    amount_paid_cents = v_paid,
    balance_cents = v_total - v_paid - v_payer_amount,
    status = case
      when v_total = 0 then 'void'
      when v_paid >= (v_total - v_payer_amount) then 'paid'
      when v_paid > 0 then 'partial'
      else status -- Keep current status if no payments
    end,
    updated_at = now()
  where id = v_invoice_id;

  return null;
end;
$$ language plpgsql;

-- =============================================================================
-- FIX: Update client balance recalculation to use correct invoice balance
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
  -- balance_cents already accounts for external payer amounts
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

-- =============================================================================
-- DATA FIX: Recalculate all existing invoices with payer allocations
-- =============================================================================

do $$
declare
  invoice_rec record;
begin
  -- Find all invoices that have payer allocations
  for invoice_rec in
    select distinct i.id
    from public.invoices i
    inner join public.invoice_payer_allocations ipa on ipa.invoice_id = i.id
  loop
    -- Recalculate each one
    perform public.update_invoice_payer_amount(invoice_rec.id);
  end loop;
end;
$$;
