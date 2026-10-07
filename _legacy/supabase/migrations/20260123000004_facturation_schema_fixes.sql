-- Migration: facturation_schema_fixes
-- Module: facturation
-- Gate: Schema improvements based on code review
-- Created: 2026-01-23

-- =============================================================================
-- FIX 1: Add unique constraint for one active invoice per appointment
-- Allows voided invoices but prevents multiple active invoices
-- =============================================================================

create unique index if not exists invoices_appointment_active_unique_idx
  on public.invoices(appointment_id)
  where status != 'void';

comment on index public.invoices_appointment_active_unique_idx is
  'Ensures only one non-voided invoice per appointment';

-- =============================================================================
-- FIX 2: Add constraint for discount validation on line items
-- =============================================================================

alter table public.invoice_line_items
  add constraint invoice_line_items_discount_check check (
    (discount_type is null and discount_value is null) or
    (discount_type = 'percent' and discount_value >= 0 and discount_value <= 100) or
    (discount_type = 'fixed' and discount_value >= 0)
  );

-- =============================================================================
-- FIX 3: Add constraint for line item total consistency
-- =============================================================================

alter table public.invoice_line_items
  add constraint invoice_line_items_total_check check (
    total_cents = subtotal_cents + tax_tps_cents + tax_tvq_cents
  );

-- =============================================================================
-- FIX 4: Add missing index for due date queries (overdue invoices)
-- =============================================================================

create index if not exists invoices_due_date_idx
  on public.invoices(due_date)
  where due_date is not null;

-- =============================================================================
-- FIX 5: Add partial index for QBO sync pending invoices
-- =============================================================================

create index if not exists invoices_qbo_sync_pending_idx
  on public.invoices(id)
  where qbo_sync_status = 'pending';

-- =============================================================================
-- FIX 6: Remove redundant index (invoice_number already has unique constraint)
-- =============================================================================

drop index if exists public.invoices_invoice_number_idx;

-- =============================================================================
-- FIX 7: Change default QBO sync status to 'not_applicable'
-- Will be set to 'pending' only when QBO is connected
-- =============================================================================

alter table public.invoices
  alter column qbo_sync_status set default 'not_applicable';

-- =============================================================================
-- FIX 8: Add helper function for professional_id lookup (RLS performance)
-- =============================================================================

create or replace function public.get_my_professional_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.professionals p
  join public.profiles pr on pr.id = p.profile_id
  where pr.user_id = auth.uid()
  limit 1;
$$;

comment on function public.get_my_professional_id() is
  'Returns the professional_id for the current authenticated user, or null if not a provider';

-- =============================================================================
-- FIX 9: Improve invoice totals recalculation to be atomic
-- Uses single statement to avoid race conditions
-- =============================================================================

create or replace function public.recalculate_invoice_totals()
returns trigger
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  -- Determine which invoice to recalculate
  if tg_table_name = 'invoice_line_items' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  elsif tg_table_name = 'invoice_payments' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  else
    return null;
  end if;

  -- Atomic update using CTEs to avoid race conditions
  with line_totals as (
    select
      coalesce(sum(subtotal_cents + discount_cents), 0) as subtotal,
      coalesce(sum(discount_cents), 0) as discount,
      coalesce(sum(tax_tps_cents), 0) as tax_tps,
      coalesce(sum(tax_tvq_cents), 0) as tax_tvq,
      coalesce(sum(total_cents), 0) as total
    from public.invoice_line_items
    where invoice_id = v_invoice_id
  ),
  payment_totals as (
    select coalesce(sum(amount_cents), 0) as paid
    from public.invoice_payments
    where invoice_id = v_invoice_id
  )
  update public.invoices
  set
    subtotal_cents = line_totals.subtotal,
    discount_cents = line_totals.discount,
    tax_tps_cents = line_totals.tax_tps,
    tax_tvq_cents = line_totals.tax_tvq,
    total_cents = line_totals.total,
    amount_paid_cents = payment_totals.paid,
    balance_cents = line_totals.total - payment_totals.paid,
    status = case
      when invoices.status = 'void' then 'void' -- Don't change voided invoices
      when invoices.status = 'draft' and line_totals.total = 0 then 'draft' -- Keep draft if empty
      when payment_totals.paid >= line_totals.total and line_totals.total > 0 then 'paid'
      when payment_totals.paid > 0 then 'partial'
      else invoices.status
    end,
    updated_at = now()
  from line_totals, payment_totals
  where invoices.id = v_invoice_id;

  return null;
end;
$$ language plpgsql;

-- =============================================================================
-- FIX 10: Improve client balance recalculation to handle client_id changes
-- =============================================================================

create or replace function public.recalculate_client_balance()
returns trigger
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_old_client_id uuid;
  v_balance int;
begin
  -- Handle client_id changes on updates
  if tg_op = 'UPDATE' and old.client_id != new.client_id then
    -- Recalculate old client's balance
    select coalesce(sum(-balance_cents), 0)
    into v_balance
    from public.invoices
    where client_id = old.client_id
      and status != 'void';

    update public.clients
    set balance_cents = v_balance
    where id = old.client_id;
  end if;

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

-- =============================================================================
-- FIX 11: Add security definer to invoice number generator for consistency
-- =============================================================================

create or replace function public.generate_invoice_number()
returns trigger
security definer
set search_path = public
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(current_date, 'YYYY') || '-' ||
                          lpad(nextval('public.invoices_invoice_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- FIX 12: Add RPC function to update invoice external payer amount
-- Called after allocating or removing payer allocations
-- =============================================================================

create or replace function public.update_invoice_payer_amount(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
begin
  -- Sum all payer allocations for this invoice
  select coalesce(sum(amount_cents), 0)
  into v_total
  from public.invoice_payer_allocations
  where invoice_id = p_invoice_id;

  -- Update the invoice
  update public.invoices
  set external_payer_amount_cents = v_total,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

comment on function public.update_invoice_payer_amount(uuid) is
  'Updates the external_payer_amount_cents on an invoice from its payer allocations';

-- =============================================================================
-- FIX 13: Add trigger to auto-update external payer amount when allocations change
-- =============================================================================

create or replace function public.recalculate_invoice_payer_amount()
returns trigger
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  perform public.update_invoice_payer_amount(v_invoice_id);
  return null;
end;
$$ language plpgsql;

create trigger invoice_payer_allocations_update_total
  after insert or update or delete on public.invoice_payer_allocations
  for each row
  execute function public.recalculate_invoice_payer_amount();
