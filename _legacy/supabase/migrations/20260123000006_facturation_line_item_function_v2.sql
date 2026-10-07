-- Migration: facturation_line_item_function_v2
-- Module: facturation
-- Gate: Updates RPC function to support file opening fee and calculate invoice totals
-- Created: 2026-01-23

-- =============================================================================
-- DROP OLD FUNCTION AND CREATE UPDATED VERSION
-- =============================================================================

drop function if exists public.create_invoice_with_line_item(uuid, uuid, text, text);

create or replace function public.create_invoice_with_line_item(
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes_client text default null,
  p_notes_internal text default null,
  p_add_file_opening_fee boolean default false
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
  v_line_order int := 0;
  -- For file opening fee
  v_fof_service_id uuid;
  v_fof_name text;
  v_fof_key text;
  v_fof_price_cents int;
  v_fof_is_taxable boolean;
  v_fof_tax_tps_cents int;
  v_fof_tax_tvq_cents int;
  v_fof_total_cents int;
  -- Invoice totals
  v_invoice_subtotal_cents int := 0;
  v_invoice_tax_tps_cents int := 0;
  v_invoice_tax_tvq_cents int := 0;
  v_invoice_total_cents int := 0;
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

    -- Insert the service line item
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
      v_line_order
    );

    -- Accumulate invoice totals
    v_invoice_subtotal_cents := v_invoice_subtotal_cents + v_price_cents;
    v_invoice_tax_tps_cents := v_invoice_tax_tps_cents + v_tax_tps_cents;
    v_invoice_tax_tvq_cents := v_invoice_tax_tvq_cents + v_tax_tvq_cents;
    v_invoice_total_cents := v_invoice_total_cents + v_total_cents;
    v_line_order := v_line_order + 1;
  end if;

  -- Add file opening fee if requested
  if p_add_file_opening_fee then
    -- Look up the ouverture_dossier service
    select
      s.id,
      s.name_fr,
      s.key,
      coalesce(s.is_taxable_override, false)
    into
      v_fof_service_id,
      v_fof_name,
      v_fof_key,
      v_fof_is_taxable
    from public.services s
    where s.key = 'ouverture_dossier'
      and s.is_active = true
    limit 1;

    if v_fof_service_id is not null then
      -- Get price for file opening fee
      select sp.price_cents
      into v_fof_price_cents
      from public.service_prices sp
      where sp.service_id = v_fof_service_id
        and sp.is_active = true
      limit 1;

      v_fof_price_cents := coalesce(v_fof_price_cents, 2500); -- Default $25 if not set

      -- Calculate tax for file opening fee
      if v_fof_is_taxable then
        v_fof_tax_tps_cents := round(v_fof_price_cents * 0.05);
        v_fof_tax_tvq_cents := round(v_fof_price_cents * 0.09975);
      else
        v_fof_tax_tps_cents := 0;
        v_fof_tax_tvq_cents := 0;
      end if;

      v_fof_total_cents := v_fof_price_cents + v_fof_tax_tps_cents + v_fof_tax_tvq_cents;

      -- Insert file opening fee line item
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
        'file_opening_fee',
        v_fof_service_id,
        coalesce(v_fof_name, 'Ouverture de dossier'),
        coalesce(v_fof_key, 'ouverture_dossier'),
        'unit',
        1,
        null,
        v_fof_price_cents,
        null,
        null,
        null,
        0,
        v_fof_is_taxable,
        case when v_fof_is_taxable then 0.05 else null end,
        case when v_fof_is_taxable then 0.09975 else null end,
        v_fof_tax_tps_cents,
        v_fof_tax_tvq_cents,
        v_fof_price_cents,
        v_fof_total_cents,
        v_line_order
      );

      -- Accumulate invoice totals
      v_invoice_subtotal_cents := v_invoice_subtotal_cents + v_fof_price_cents;
      v_invoice_tax_tps_cents := v_invoice_tax_tps_cents + v_fof_tax_tps_cents;
      v_invoice_tax_tvq_cents := v_invoice_tax_tvq_cents + v_fof_tax_tvq_cents;
      v_invoice_total_cents := v_invoice_total_cents + v_fof_total_cents;
    end if;
  end if;

  -- Update invoice totals
  update public.invoices
  set
    subtotal_cents = v_invoice_subtotal_cents,
    tax_tps_cents = v_invoice_tax_tps_cents,
    tax_tvq_cents = v_invoice_tax_tvq_cents,
    total_cents = v_invoice_total_cents,
    balance_cents = v_invoice_total_cents
  where id = v_invoice_id;

  return v_invoice_id;
end;
$$;

comment on function public.create_invoice_with_line_item(uuid, uuid, text, text, boolean) is
  'Creates an invoice with its initial service line item and optional file opening fee. Uses SECURITY DEFINER to ensure line items can be inserted.';

-- Grant execute to authenticated users (RLS on invoices still applies for the invoice insert)
grant execute on function public.create_invoice_with_line_item(uuid, uuid, text, text, boolean) to authenticated;
