-- =============================================================================
-- Facturation: no file-opening fee when a relative already has a billed file (R-78)
-- =============================================================================
-- Decision: R-78 (Christine, answer 7 of the second series), amending BI-6.
--
-- * `private.billing_file_opening_due(org, client, except_invoice)`: the one rule for « this
--   would be the file's first invoice ». Due when neither the file nor any file related to it
--   (Clients' `private.client_relative_ids`: either side of a relation, whatever its type) has a
--   non-credited invoice (a draft counts, as for the file's own invoices since BI-6), the invoice
--   being built (`except_invoice`) left out. « Un proche a déjà un dossier facturé » is read as
--   any live invoice of the relative, not only one carrying an opening fee: an imported or older
--   invoice without the fee still means the family's file was opened (default — révisable).
-- * Its callers, bodies otherwise unchanged: `private.billing_invoice_appointments` (behind
--   `create_invoice` and the morning queue; the current body of `*_billing_third_party_payers`)
--   and `get_appointment_billing`'s preview (`*_billing_appointment_billing`). An explicit
--   `p_file_opening` still wins.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_relatives_opening_fee', true);

create function private.billing_file_opening_due(p_org uuid, p_client_id uuid, p_except_invoice_id uuid default null)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.invoices i
     where i.org_id = p_org
       and i.status <> 'credited'
       and i.id is distinct from p_except_invoice_id
       and (i.client_id = p_client_id
            or i.client_id in (select x from private.client_relative_ids(p_org, p_client_id) x)))
$$;
revoke all on function private.billing_file_opening_due(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- A session's draft (the body of *_billing_third_party_payers), the file opening by the rule above.
create or replace function private.billing_invoice_appointments(
  p_org uuid, p_appointment_ids uuid[], p_payer_client_id uuid, p_file_opening boolean,
  p_notes_client text, p_notes_internal text, p_actor uuid, p_allow_missing boolean
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_client uuid;
  v_id uuid;
  v_first_date date;
  v_file_service uuid;
  a record;
  v_title uuid;
  v_count int := 0;
begin
  if coalesce(pg_catalog.cardinality(p_appointment_ids), 0) = 0 then
    raise exception 'Choisissez les rendez-vous à facturer.' using errcode = 'P0001', hint = 'appointment_ids';
  end if;
  -- One appointment at a time: no second invoice for it in a concurrent call.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.appointment:' || x::text, 0))
     from (select distinct x from pg_catalog.unnest(p_appointment_ids) x order by x) y;
  for a in select f.* from private.appointment_billing_facts(p_org, p_appointment_ids) f order by f.starts_at loop
    v_count := v_count + 1;
    if a.is_personal then
      raise exception 'Un rendez-vous personnel ne se facture pas.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if a.state not in ('booked', 'confirmed', 'completed') then
      raise exception 'Ce rendez-vous est annulé ou en attente d''acceptation : il ne se facture pas ainsi.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if v_client is null then
      v_client := a.client_ids[1];
      v_first_date := a.local_date;
      v_id := private.billing_new_invoice(p_org, v_client, p_payer_client_id, 'appointment', a.appointment_id, p_actor);
    elsif not (v_client = any (a.client_ids)) then
      raise exception 'Une facture regroupe les rendez-vous d''un même dossier.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if exists (select 1 from public.invoice_lines l where l.appointment_id = a.appointment_id and l.line_type = 'service' and not l.credited) then
      raise exception 'Le rendez-vous du % est déjà facturé.', private.format_date_fr(a.local_date) using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    select (f.title_ids)[1] into v_title from private.professional_booking_facts(p_org, a.professional_id) f;
    perform private.billing_add_service_line(p_org, v_id, 'service', a.service_id, v_title, a.local_date, a.appointment_id,
                                             a.professional_id, p_allow_missing);
  end loop;
  if v_count <> (select count(distinct x) from pg_catalog.unnest(p_appointment_ids) x) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_ids';
  end if;
  select b.file_opening_service_id into v_file_service from private.billing_policy_for(p_org, v_first_date) b;
  if v_file_service is not null and coalesce(p_file_opening,
       private.billing_file_opening_due(p_org, v_client, v_id)) then
    perform private.billing_add_service_line(p_org, v_id, 'file_opening', v_file_service, null, v_first_date, null, null, p_allow_missing);
  end if;
  update public.invoices i
     set notes_client = nullif(pg_catalog.btrim(coalesce(p_notes_client, '')), ''),
         notes_internal = nullif(pg_catalog.btrim(coalesce(p_notes_internal, '')), '')
   where i.id = v_id;
  perform private.billing_apply_payer_shares(p_org, v_id);
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  return v_id;
end;
$$;


-- An appointment's billing (the body of *_billing_appointment_billing), the file opening by the rule above.
create or replace function public.get_appointment_billing(p_appointment_id uuid)
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

    -- The file-opening fee, when this would be the client's first invoice (create_invoice's rule, R-78).
    select b.file_opening_service_id into v_file_service from private.billing_policy_for(v_org, a.local_date) b;
    if v_file_service is not null
       and private.billing_file_opening_due(v_org, a.client_ids[1]) then
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

select pg_catalog.set_config('app.audit_source', '', true);
