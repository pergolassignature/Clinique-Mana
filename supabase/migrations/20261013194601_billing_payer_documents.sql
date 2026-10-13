-- Facturation FP, part 3: what a payer invoice prints (Christine 12, decision FP-11).
--
-- - Professionnels publishes `private.professional_payer_numbers_of(org, ids, payer_type)`: the
--   professionals' numbers with a payer (today IVAC's, P4-14), granted to no role; Facturation reads
--   it from its document function only (ADR 0003: data, never a raw table of another module).
-- - `billing_invoice_payer` gives an organisation's kind and the clinic's provider number with it.
-- - `billing_document` gives `payer_numbers` (each professional's IVAC number) for an IVAC invoice,
--   so its PDF names them; empty otherwise.
-- Additive: two `create or replace` of Billing's private functions and one new private function.

select pg_catalog.set_config('app.audit_source', 'migration:billing_payer_documents', true);

-- -----------------------------------------------------------------------------
-- Professionnels: the numbers a professional holds with a payer (published)
-- -----------------------------------------------------------------------------
create function private.professional_payer_numbers_of(p_org uuid, p_ids uuid[], p_payer_type text)
returns table (professional_id uuid, number text)
language sql
stable
set search_path = ''
as $$
  select n.professional_id, n.number
    from public.professional_payer_numbers n
   where n.org_id = p_org and n.payer_type = p_payer_type and n.professional_id = any (coalesce(p_ids, '{}'))
$$;
revoke all on function private.professional_payer_numbers_of(uuid, uuid[], text) from public, anon, authenticated, service_role;

-- An organisation as a document's payer: its kind and the clinic's provider number with it (FP-11).
create or replace function private.billing_invoice_payer(p_invoice public.invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_invoice.payer_kind = 'organisation' then (
           select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'first_name', coalesce(o.contact_name, o.name),
                                                'client_number', null, 'language', o.language, 'kind', 'organisation',
                                                'organisation_kind', o.kind, 'provider_number', o.provider_number)
             from public.payer_organisations o where o.id = p_invoice.payer_organisation_id)
         else private.billing_person(p_invoice.org_id, p_invoice.payer_client_id) end
$$;
-- What a document prints: an IVAC invoice's professionals' IVAC numbers (FP-11).
create or replace function private.billing_document(p_org uuid, p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.invoices;
  c public.credit_notes;
  r public.receipts;
  p public.payments;
  s public.statements;
  v_ids uuid[];
begin
  if p_kind = 'invoice' then
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_id;
  elsif p_kind = 'credit_note' then
    select x.* into c from public.credit_notes x where x.org_id = p_org and x.id = p_id;
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = c.invoice_id;
  elsif p_kind = 'receipt' then
    select x.* into r from public.receipts x where x.org_id = p_org and x.id = p_id;
    select x.* into p from public.payments x where x.org_id = p_org and x.id = r.payment_id;
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = r.invoice_id;
  elsif p_kind = 'statement' then
    select x.* into s from public.statements x where x.org_id = p_org and x.id = p_id;
    if s.id is null then
      return null;
    end if;
    select coalesce(pg_catalog.array_agg(i.id), '{}') into v_ids from public.invoices i
     where i.org_id = p_org and i.client_id = s.client_id and i.payer_client_id = s.payer_client_id and i.payer_kind <> 'organisation' and i.status <> 'draft'
       and i.issued_on between s.period_from and s.period_to;
    return pg_catalog.jsonb_build_object(
      'kind', 'statement', 'id', s.id, 'year', s.year, 'period_from', s.period_from, 'period_to', s.period_to,
      'issued_on', (s.created_at at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto'))::date,
      'clinic', private.billing_clinic(p_org), 'client', private.billing_person(p_org, s.client_id),
      'payer', private.billing_person(p_org, s.payer_client_id),
      'invoices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'id', i.id, 'number', i.number, 'issued_on', i.issued_on, 'status', i.status, 'total_cents', i.total_cents,
                    'paid_cents', i.paid_cents, 'credit_note_number', (select cn.number from public.credit_notes cn where cn.invoice_id = i.id))
                    order by i.issued_on, i.seq)
                    from public.invoices i where i.id = any (v_ids)), '[]'::jsonb),
      'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'receipt_number', rc.number, 'paid_on', x.paid_on, 'amount_cents', x.amount_cents, 'mode', m.name,
                    'invoice_number', i.number) order by x.paid_on, rc.seq)
                    from public.payments x join public.receipts rc on rc.payment_id = x.id
                    join public.invoices i on i.id = x.invoice_id
                    join public.payment_modes m on m.org_id = x.org_id and m.code = x.mode_code
                   where x.invoice_id = any (v_ids)), '[]'::jsonb),
      'lines', private.billing_lines(p_org, v_ids),
      'professionals', private.billing_professionals(p_org, v_ids));
  else
    return null;
  end if;
  if v.id is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'kind', p_kind,
    'id', p_id,
    'number', case p_kind when 'invoice' then v.number when 'credit_note' then c.number else r.number end,
    'issued_on', case p_kind when 'invoice' then v.issued_on when 'credit_note' then c.issued_on else r.issued_on end,
    'invoice', pg_catalog.jsonb_build_object(
      'id', v.id, 'number', v.number, 'status', v.status, 'issued_on', v.issued_on, 'due_on', v.due_on, 'tax_exempt', v.tax_exempt,
      'gst_rate', v.gst_rate, 'qst_rate', v.qst_rate, 'subtotal_cents', v.subtotal_cents, 'gst_cents', v.gst_cents,
      'qst_cents', v.qst_cents, 'total_cents', v.total_cents, 'paid_cents', v.paid_cents, 'notes_client', v.notes_client,
      'payer_kind', v.payer_kind, 'payer_reference', v.payer_reference),
    'payment', case when p_kind = 'receipt' then pg_catalog.jsonb_build_object(
      'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
      'mode', (select m.name from public.payment_modes m where m.org_id = p.org_id and m.code = p.mode_code)) end,
    'clinic', private.billing_clinic(p_org),
    'client', private.billing_person(p_org, v.client_id),
    'payer', private.billing_invoice_payer(v),
    'lines', private.billing_lines(p_org, array[v.id]),
    'professionals', private.billing_professionals(p_org, array[v.id]),
    -- FP-11: an IVAC invoice names each professional's IVAC number.
    'payer_numbers', case when v.payer_kind = 'organisation'
                            and (select o.kind from public.payer_organisations o where o.id = v.payer_organisation_id) = 'ivac'
                          then coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('professional_id', n.professional_id,
                                                                                                    'number', n.number)
                                                                     order by n.number)
                                           from private.professional_payer_numbers_of(p_org,
                                                  (select coalesce(pg_catalog.array_agg(distinct l.professional_id), '{}')
                                                     from public.invoice_lines l
                                                    where l.org_id = p_org and l.invoice_id = v.id and l.professional_id is not null),
                                                  'ivac') n), '[]'::jsonb)
                          else '[]'::jsonb end);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
