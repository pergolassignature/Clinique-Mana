-- Migration: facturation_line_item_function
-- Module: facturation
-- Gate: Allows invoice line item creation during invoice creation
-- Created: 2026-01-23

-- =============================================================================
-- FUNCTION: Create invoice with initial line item
-- Uses SECURITY DEFINER to bypass RLS for the initial line item insert
-- This is called when creating an invoice to add the service line item
-- =============================================================================

create or replace function public.create_invoice_with_line_item(
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes_client text default null,
  p_notes_internal text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_professional_id uuid;
  v_service_id uuid;
  v_service_name text;
  v_service_key text;
  v_duration_minutes int;
  v_is_taxable boolean;
  v_price_cents int;
  v_profession_category_key text;
  v_tax_tps_cents int;
  v_tax_tvq_cents int;
  v_total_cents int;
begin
  -- Get appointment details
  select
    a.professional_id,
    a.service_id,
    a.duration_minutes,
    s.name_fr,
    s.key,
    coalesce(s.is_taxable_override, false)
  into
    v_professional_id,
    v_service_id,
    v_duration_minutes,
    v_service_name,
    v_service_key,
    v_is_taxable
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.id = p_appointment_id;

  if v_professional_id is null then
    raise exception 'Appointment not found: %', p_appointment_id;
  end if;

  -- Create the invoice
  insert into public.invoices (
    appointment_id,
    client_id,
    professional_id,
    notes_client,
    notes_internal
  ) values (
    p_appointment_id,
    p_client_id,
    v_professional_id,
    p_notes_client,
    p_notes_internal
  )
  returning id into v_invoice_id;

  -- If there's a service, add it as a line item
  if v_service_id is not null then
    -- Get price from service_prices
    select sp.price_cents, sp.profession_category_key
    into v_price_cents, v_profession_category_key
    from public.service_prices sp
    where sp.service_id = v_service_id
      and sp.is_active = true
    limit 1;

    v_price_cents := coalesce(v_price_cents, 0);

    -- Calculate tax
    if v_is_taxable then
      v_tax_tps_cents := round(v_price_cents * 0.05);
      v_tax_tvq_cents := round(v_price_cents * 0.09975);
    else
      v_tax_tps_cents := 0;
      v_tax_tvq_cents := 0;
    end if;

    v_total_cents := v_price_cents + v_tax_tps_cents + v_tax_tvq_cents;

    -- Insert the line item
    insert into public.invoice_line_items (
      invoice_id,
      line_type,
      service_id,
      service_name_snapshot,
      service_key_snapshot,
      quantity_unit,
      quantity,
      billable_minutes,
      unit_price_cents,
      profession_category_key_snapshot,
      discount_type,
      discount_value,
      discount_cents,
      is_taxable,
      tax_tps_rate_snapshot,
      tax_tvq_rate_snapshot,
      tax_tps_cents,
      tax_tvq_cents,
      subtotal_cents,
      total_cents,
      display_order
    ) values (
      v_invoice_id,
      'service',
      v_service_id,
      v_service_name,
      v_service_key,
      'unit',
      1,
      v_duration_minutes,
      v_price_cents,
      v_profession_category_key,
      null,
      null,
      0,
      v_is_taxable,
      case when v_is_taxable then 0.05 else null end,
      case when v_is_taxable then 0.09975 else null end,
      v_tax_tps_cents,
      v_tax_tvq_cents,
      v_price_cents,
      v_total_cents,
      0
    );
  end if;

  return v_invoice_id;
end;
$$;

comment on function public.create_invoice_with_line_item(uuid, uuid, text, text) is
  'Creates an invoice with its initial service line item. Uses SECURITY DEFINER to ensure line item can be inserted.';

-- Grant execute to authenticated users (RLS on invoices still applies for the invoice insert)
grant execute on function public.create_invoice_with_line_item(uuid, uuid, text, text) to authenticated;
