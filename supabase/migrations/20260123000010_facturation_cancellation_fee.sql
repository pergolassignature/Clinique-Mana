-- Migration: facturation_cancellation_fee
-- Module: facturation
-- Gate: Updates RPC function to handle cancelled appointments correctly
-- Created: 2026-01-23

-- =============================================================================
-- UPDATED FUNCTION: Handle cancelled appointments
-- - If appointment is cancelled and cancellation_fee_applied = true:
--   Bill the cancellation fee (service price * cancellation_fee_percent / 100)
-- - If appointment is cancelled and cancellation_fee_applied = false:
--   No service line item added
-- - If appointment is not cancelled:
--   Bill the full service as before
-- =============================================================================

drop function if exists public.create_invoice_with_line_item(uuid, uuid, text, text, boolean);

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
  -- Appointment status and cancellation fields
  v_appointment_status text;
  v_cancellation_fee_applied boolean;
  v_cancellation_fee_percent numeric(5,2);
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
  -- Created by
  v_created_by_profile_id uuid;
begin
  -- Validate input
  if p_appointment_id is null then
    raise exception 'appointment_id is required';
  end if;
  if p_client_id is null then
    raise exception 'client_id is required';
  end if;

  -- Check if invoice already exists for this appointment (non-void)
  if exists (
    select 1 from public.invoices
    where appointment_id = p_appointment_id
    and status != 'void'
  ) then
    raise exception 'Invoice already exists for this appointment';
  end if;

  -- Validate client exists
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found: %', p_client_id;
  end if;

  -- Get current user's profile ID for created_by
  select p.id into v_created_by_profile_id
  from public.profiles p
  where p.user_id = auth.uid();

  -- Get appointment details including cancellation info
  select
    a.professional_id,
    a.service_id,
    a.duration_minutes,
    a.status,
    coalesce(a.cancellation_fee_applied, false),
    coalesce(a.cancellation_fee_percent, 0),
    s.name_fr,
    s.key,
    coalesce(s.is_taxable_override, false)
  into
    v_professional_id,
    v_service_id,
    v_duration_minutes,
    v_appointment_status,
    v_cancellation_fee_applied,
    v_cancellation_fee_percent,
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
    notes_internal,
    created_by
  ) values (
    p_appointment_id,
    p_client_id,
    v_professional_id,
    p_notes_client,
    p_notes_internal,
    v_created_by_profile_id
  )
  returning id into v_invoice_id;

  -- Handle service line item based on appointment status
  if v_service_id is not null then
    -- Get price from service_prices
    select sp.price_cents, sp.profession_category_key
    into v_price_cents, v_profession_category_key
    from public.service_prices sp
    where sp.service_id = v_service_id
      and sp.is_active = true
    order by sp.created_at desc
    limit 1;

    v_price_cents := coalesce(v_price_cents, 0);

    -- CASE 1: Appointment is cancelled
    if v_appointment_status = 'cancelled' then
      -- Only add line item if cancellation fee is applied
      if v_cancellation_fee_applied and v_cancellation_fee_percent > 0 then
        -- Calculate cancellation fee based on percentage
        v_price_cents := round(v_price_cents * v_cancellation_fee_percent / 100);

        -- Calculate tax on cancellation fee
        if v_is_taxable then
          v_tax_tps_cents := round(v_price_cents * 0.05);
          v_tax_tvq_cents := round(v_price_cents * 0.09975);
        else
          v_tax_tps_cents := 0;
          v_tax_tvq_cents := 0;
        end if;

        v_total_cents := v_price_cents + v_tax_tps_cents + v_tax_tvq_cents;

        -- Insert cancellation fee line item
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
          display_order,
          description
        ) values (
          v_invoice_id,
          'cancellation_fee',
          v_service_id,
          v_service_name || ' - Frais d''annulation (' || v_cancellation_fee_percent || '%)',
          v_service_key,
          'unit',
          1,
          null,
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
          v_line_order,
          'Frais d''annulation - ' || v_cancellation_fee_percent || '% du service'
        );

        -- Accumulate invoice totals
        v_invoice_subtotal_cents := v_invoice_subtotal_cents + v_price_cents;
        v_invoice_tax_tps_cents := v_invoice_tax_tps_cents + v_tax_tps_cents;
        v_invoice_tax_tvq_cents := v_invoice_tax_tvq_cents + v_tax_tvq_cents;
        v_invoice_total_cents := v_invoice_total_cents + v_total_cents;
        v_line_order := v_line_order + 1;
      end if;
      -- If cancelled but no fee applied, don't add any service line item

    -- CASE 2: Appointment is NOT cancelled - bill full service
    else
      -- Calculate tax on full service
      if v_is_taxable then
        v_tax_tps_cents := round(v_price_cents * 0.05);
        v_tax_tvq_cents := round(v_price_cents * 0.09975);
      else
        v_tax_tps_cents := 0;
        v_tax_tvq_cents := 0;
      end if;

      v_total_cents := v_price_cents + v_tax_tps_cents + v_tax_tvq_cents;

      -- Insert the full service line item
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
  end if;

  -- Add file opening fee if requested (only for non-cancelled appointments)
  if p_add_file_opening_fee and v_appointment_status != 'cancelled' then
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
      order by sp.created_at desc
      limit 1;

      v_fof_price_cents := coalesce(v_fof_price_cents, 3500); -- Default $35 if not set

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

  -- Create audit log entry
  insert into public.invoice_audit_log (
    invoice_id,
    actor_id,
    action,
    new_value,
    context
  ) values (
    v_invoice_id,
    v_created_by_profile_id,
    'created',
    jsonb_build_object(
      'total_cents', v_invoice_total_cents,
      'status', 'draft'
    ),
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'client_id', p_client_id,
      'appointment_status', v_appointment_status,
      'cancellation_fee_applied', v_cancellation_fee_applied,
      'cancellation_fee_percent', v_cancellation_fee_percent
    )
  );

  return v_invoice_id;
end;
$$;

comment on function public.create_invoice_with_line_item(uuid, uuid, text, text, boolean) is
  'Creates an invoice with line items. For cancelled appointments with fee, bills cancellation fee only. For normal appointments, bills full service. Sets created_by to current user.';

-- Grant execute to authenticated users
grant execute on function public.create_invoice_with_line_item(uuid, uuid, text, text, boolean) to authenticated;
