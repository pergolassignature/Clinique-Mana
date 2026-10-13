-- =============================================================================
-- Facturation: the facts Rapports reads for « Revenus » (RP1), published as private helpers
-- =============================================================================
-- Rapports (plan §12) shows the clinic's revenue by invoice, by service and by payment, like
-- GOrendezvous's « Revenus », without reading this module's tables (CLAUDE.md §5). For definer
-- callers after their own permission check (`reports.finance`), with the org they verified;
-- granted to no role. Signatures stable.
--
-- * `billing_revenue_lines(org, from, to)`: one row per line of the invoices issued between the
--   two clinic dates (inclusive), issued or credited (a credited one carries `invoice_status`
--   `credited`: Rapports counts it apart, as GOrendezvous exports only the invoices not
--   cancelled), with the invoice's totals and what is paid.
-- * `billing_revenue_payments(org, from, to)`: the payments made between the two dates, with
--   their mode's name, the invoice's number and the professionals and services of its lines not
--   credited (for the filters).
-- * `billing_payment_mode_names(org)`: the clinic's payment modes (the filter).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_report_facts', true);

create function private.billing_revenue_lines(p_org uuid, p_from date, p_to date)
returns table (
  invoice_id uuid, number text, issued_on date, invoice_status text, client_id uuid, payer_client_id uuid,
  invoice_subtotal_cents int, invoice_gst_cents int, invoice_qst_cents int, invoice_total_cents int, invoice_paid_cents int,
  line_id uuid, line_position int, line_type text, professional_id uuid, service_id uuid, service_code int, description text,
  quantity numeric, unit_price_cents int, subtotal_cents int, gst_cents int, qst_cents int, total_cents int, credited boolean
)
language sql
stable
set search_path = ''
as $$
  select i.id, i.number, i.issued_on, i.status, i.client_id, i.payer_client_id,
         i.subtotal_cents, i.gst_cents, i.qst_cents, i.total_cents, i.paid_cents,
         l.id, l.position::int, l.line_type, l.professional_id, l.service_id, l.service_code, l.description,
         l.quantity, l.unit_price_cents, l.subtotal_cents, l.gst_cents, l.qst_cents, l.total_cents, l.credited
    from public.invoices i
    join public.invoice_lines l on l.org_id = i.org_id and l.invoice_id = i.id
   where i.org_id = p_org and i.status in ('issued', 'credited')
     and i.issued_on between p_from and p_to
   order by i.issued_on, i.year, i.seq, l.position
$$;

create function private.billing_revenue_payments(p_org uuid, p_from date, p_to date)
returns table (
  payment_id uuid, paid_on date, mode_code text, mode_name text, amount_cents int, reference text,
  invoice_id uuid, number text, client_id uuid, payer_client_id uuid, professional_ids uuid[], service_ids uuid[]
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.paid_on, p.mode_code, m.name, p.amount_cents, p.reference,
         i.id, i.number, i.client_id, p.payer_client_id,
         coalesce((select pg_catalog.array_agg(distinct l.professional_id) from public.invoice_lines l
                    where l.org_id = i.org_id and l.invoice_id = i.id and not l.credited and l.professional_id is not null), '{}'),
         coalesce((select pg_catalog.array_agg(distinct l.service_id) from public.invoice_lines l
                    where l.org_id = i.org_id and l.invoice_id = i.id and not l.credited and l.service_id is not null), '{}')
    from public.payments p
    join public.invoices i on i.org_id = p.org_id and i.id = p.invoice_id
    join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
   where p.org_id = p_org and p.paid_on between p_from and p_to
   order by p.paid_on, p.created_at, p.id
$$;

create function private.billing_payment_mode_names(p_org uuid)
returns table (code text, name text, sort_order int)
language sql
stable
set search_path = ''
as $$
  select m.code, m.name, m.sort_order::int
    from public.payment_modes m
   where m.org_id = p_org
   order by m.sort_order, m.name
$$;

revoke all on function private.billing_revenue_lines(uuid, date, date), private.billing_revenue_payments(uuid, date, date),
  private.billing_payment_mode_names(uuid)
  from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
