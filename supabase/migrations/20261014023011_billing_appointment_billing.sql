-- =============================================================================
-- Facturation: an appointment's billing, for Rendez-vous' sheet (parity audit L10, BI-22)
-- =============================================================================
-- The appointment sheet gains a « Facturation » tab through the core slot `appointment.sheet`
-- (Facturation fills it, `billing.view`). It reads one definer RPC:
--
-- * `get_appointment_billing(appointment)` (`billing.view` first) → null when the appointment is
--   not the clinic's or is personal; else
--     - `lines`: every invoice line of the appointment (its session, its cancellation fee), live or
--       credited, with its invoice's number, state, payment state, total and what is paid, and the
--       client billed;
--     - `invoiceable`: booked, confirmed or completed, and no live session line (what « Créer la
--       facture » with `create_invoice` accepts);
--     - `preview` (when invoiceable): the price `create_invoice` would put on the session line, for
--       the first client (Services et tarifs' `service_price` with her rate and tax exemption, the
--       professional's title, the appointment's day), its taxes and total, `missing` when the price
--       is not fixed; and the file-opening fee when this would be the client's first invoice;
--     - `fee`: the cancellation-fee decision of a late cancellation or an absence (kind, state,
--       percent, amount, its invoice), null when there is none.
--   Reads only Facturation's tables and the facts Rendez-vous, Clients, Professionnels and
--   Services et tarifs publish. No write: invoicing stays `create_invoice`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_appointment_billing', true);

create function public.get_appointment_billing(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  a record;
  c record;
  p record;
  f record;
  amt record;
  v_title uuid;
  v_live boolean;
  v_invoiceable boolean;
  v_gst numeric;
  v_qst numeric;
  v_preview jsonb;
  v_file jsonb;
  v_file_service uuid;
  v_fee jsonb;
begin
  select x.* into a from private.appointment_billing_facts(v_org, array[p_appointment_id]) x;
  if a.appointment_id is null or a.is_personal then
    return null;
  end if;

  v_live := exists (select 1 from public.invoice_lines l
                     where l.org_id = v_org and l.appointment_id = p_appointment_id and l.line_type = 'service' and not l.credited);
  v_invoiceable := a.state in ('booked', 'confirmed', 'completed') and not v_live and pg_catalog.cardinality(a.client_ids) > 0;

  if v_invoiceable then
    select x.* into c from private.clients_billing_facts(v_org, array[a.client_ids[1]]) x;
    select (x.title_ids)[1] into v_title from private.professional_booking_facts(v_org, a.professional_id) x;
    select x.* into p from private.service_price(v_org, a.service_id, v_title, c.rate_variant, a.local_date, c.tax_exempt) x;
    v_gst := private.billing_tax_rate(v_org, 'gst', a.local_date);
    v_qst := private.billing_tax_rate(v_org, 'qst', a.local_date);
    if p.source is not null then
      select x.* into amt
        from private.billing_line_amounts(1, case when p.source = 'free' then 0 else p.price_cents end,
                                          p.tax_rule = 'taxable' and not coalesce(c.tax_exempt, false), v_gst, v_qst) x;
    end if;
    v_preview := pg_catalog.jsonb_build_object(
      'client_id', a.client_ids[1],
      'service_id', a.service_id,
      'source', p.source,
      'missing', p.source is null or (p.price_cents is null and p.source not in ('entered', 'free')),
      'variant_applied', coalesce(p.variant_applied, false),
      'subtotal_cents', case when p.source is null or (p.price_cents is null and p.source <> 'free') then null else amt.subtotal_cents end,
      'tax_cents', case when p.source is null or (p.price_cents is null and p.source <> 'free') then null else amt.gst_cents + amt.qst_cents end,
      'total_cents', case when p.source is null or (p.price_cents is null and p.source <> 'free') then null else amt.total_cents end);

    -- The file-opening fee, when this would be the client's first invoice (create_invoice's rule).
    select b.file_opening_service_id into v_file_service from private.billing_policy_for(v_org, a.local_date) b;
    if v_file_service is not null
       and not exists (select 1 from public.invoices i where i.org_id = v_org and i.client_id = a.client_ids[1] and i.status <> 'credited') then
      select x.* into f from private.service_price(v_org, v_file_service, null, c.rate_variant, a.local_date, c.tax_exempt) x;
      if f.source is not null then
        select x.* into amt
          from private.billing_line_amounts(1, case when f.source = 'free' then 0 else f.price_cents end,
                                            f.tax_rule = 'taxable' and not coalesce(c.tax_exempt, false), v_gst, v_qst) x;
      end if;
      v_file := pg_catalog.jsonb_build_object(
        'missing', f.source is null or (f.price_cents is null and f.source not in ('entered', 'free')),
        'total_cents', case when f.source is null or (f.price_cents is null and f.source <> 'free') then null else amt.total_cents end);
    end if;
    v_preview := v_preview || pg_catalog.jsonb_build_object('file_opening', v_file);
  end if;

  select pg_catalog.jsonb_build_object(
           'kind', d.kind, 'status', d.status, 'fee_percent', d.fee_percent, 'amount_cents', d.amount_cents,
           'invoice_id', d.invoice_id, 'invoice_number', i.number, 'decided_as', d.decided_as)
    into v_fee
    from public.cancellation_fee_decisions d
    left join public.invoices i on i.org_id = d.org_id and i.id = d.invoice_id
   where d.org_id = v_org and d.appointment_id = p_appointment_id
   order by d.created_at desc
   limit 1;

  return pg_catalog.jsonb_build_object(
    'appointment_id', a.appointment_id,
    'state', a.state,
    'client_ids', pg_catalog.to_jsonb(a.client_ids),
    'invoiceable', v_invoiceable,
    'lines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'line_id', l.id, 'line_type', l.line_type, 'credited', l.credited, 'line_total_cents', l.total_cents,
               'invoice_id', i.id, 'number', i.number, 'status', i.status, 'payment_status', i.payment_status,
               'invoice_total_cents', i.total_cents, 'paid_cents', i.paid_cents,
               'client_id', i.client_id, 'client_name', n.display_name)
             order by l.credited, i.created_at desc, l.position)
        from public.invoice_lines l
        join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
        left join private.clients_billing_facts(v_org, array[i.client_id]) n on true
       where l.org_id = v_org and l.appointment_id = p_appointment_id), '[]'::jsonb),
    'preview', v_preview,
    'fee', v_fee);
end;
$$;
revoke all on function public.get_appointment_billing(uuid) from public, anon;
grant execute on function public.get_appointment_billing(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
