-- =============================================================================
-- Rapports: the refunds in « Revenus » par paiement (parity audit L6)
-- =============================================================================
-- `report_revenue` (same signature, `create or replace`), view `payment` only: the refunds
-- recorded in the period (Facturation's `private.billing_revenue_refunds`) come as rows of their
-- own (`kind` `refund`, the amount negative, the payment's mode, no reference) next to the
-- payments (`kind` `payment`); each row has a `row_id`. The totals and each mode keep `count` and
-- `amount_cents` (the payments received) and add `refunds_count`, `refunds_cents` (positive) and
-- `net_cents`. The filters (mode, professional, service) apply to a refund through its payment
-- and invoice. Views `invoice` and `service` unchanged.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_revenue_refunds', true);

create or replace function public.report_revenue(
  p_view text, p_from date, p_to date,
  p_professional_id uuid default null, p_service_id uuid default null, p_mode_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.finance');
  v_limit constant int := 5000;
  v_modes jsonb;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  if p_view is null or p_view not in ('invoice', 'service', 'payment') then
    raise exception 'Vue inconnue : par facture, par service ou par paiement.' using errcode = 'P0001', hint = 'view';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', m.code, 'name', m.name) order by m.sort_order, m.name), '[]')
    into v_modes
    from private.billing_payment_mode_names(v_org) m;

  if p_view in ('invoice', 'service') then
    with l as (
      select * from private.billing_revenue_lines(v_org, p_from, p_to)
    ), live as (
      select * from l where l.invoice_status = 'issued'
    ), names as (
      select n.client_id, n.display_name, n.client_number
        from private.clients_display_names(v_org, array(
               select distinct x.id from (select live.client_id as id from live union select live.payer_client_id from live) x)) n
    ), pros as (
      select n.professional_id, n.display_name
        from private.professional_display_names(v_org, array(
               select distinct live.professional_id from live where live.professional_id is not null)) n
    ), svcs as (
      select s.service_id, s.code, s.name
        from private.service_payout_facts(v_org, array(
               select distinct live.service_id from live where live.service_id is not null)) s
    ), opts as (
      select pg_catalog.jsonb_build_object(
               'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                        order by p.display_name) from pros p), '[]'),
               'services', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.service_id, 'code', s.code, 'name', s.name)
                                                   order by s.code, s.name) from svcs s), '[]'),
               'modes', v_modes) as o
    ), credited as (
      select pg_catalog.count(*)::int as n, coalesce(pg_catalog.sum(c.invoice_total_cents), 0)::bigint as cents
        from (select distinct l.invoice_id, l.invoice_total_cents from l where l.invoice_status = 'credited') c
    ), inv as (
      select live.invoice_id, live.number, live.issued_on, live.client_id, live.payer_client_id,
             live.invoice_subtotal_cents as subtotal, live.invoice_gst_cents as gst, live.invoice_qst_cents as qst,
             live.invoice_total_cents as total, live.invoice_paid_cents as paid,
             pg_catalog.array_agg(distinct live.professional_id) filter (where live.professional_id is not null) as pro_ids
        from live
       group by live.invoice_id, live.number, live.issued_on, live.client_id, live.payer_client_id, live.invoice_subtotal_cents,
                live.invoice_gst_cents, live.invoice_qst_cents, live.invoice_total_cents, live.invoice_paid_cents
      having (p_professional_id is null or pg_catalog.bool_or(live.professional_id = p_professional_id))
         and (p_service_id is null or pg_catalog.bool_or(live.service_id = p_service_id))
    ), lines as (
      select live.* from live
       where (p_professional_id is null or live.professional_id = p_professional_id)
         and (p_service_id is null or live.service_id = p_service_id)
    )
    select case when p_view = 'invoice' then pg_catalog.jsonb_build_object(
             'view', 'invoice',
             'rows', coalesce((
               select pg_catalog.jsonb_agg(r.j order by r.issued_on desc, r.seq desc)
                 from (select i.issued_on, pg_catalog.split_part(i.number, '-', 2)::int as seq,
                              pg_catalog.jsonb_build_object(
                                'invoice_id', i.invoice_id, 'number', i.number, 'issued_on', i.issued_on,
                                'client_id', i.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                                'payer_name', case when i.payer_client_id <> i.client_id then pn.display_name end,
                                'professional_names', (select pg_catalog.string_agg(p.display_name, ', ' order by p.display_name)
                                                         from pros p where p.professional_id = any (i.pro_ids)),
                                'subtotal_cents', i.subtotal, 'gst_cents', i.gst, 'qst_cents', i.qst, 'total_cents', i.total,
                                'paid_cents', i.paid, 'balance_cents', i.total - i.paid) as j
                         from inv i
                         left join names cn on cn.client_id = i.client_id
                         left join names pn on pn.client_id = i.payer_client_id
                        order by i.issued_on desc, pg_catalog.split_part(i.number, '-', 2)::int desc
                        limit v_limit) r), '[]'),
             'totals', (select pg_catalog.jsonb_build_object(
                          'count', pg_catalog.count(*), 'subtotal_cents', coalesce(pg_catalog.sum(i.subtotal), 0),
                          'gst_cents', coalesce(pg_catalog.sum(i.gst), 0), 'qst_cents', coalesce(pg_catalog.sum(i.qst), 0),
                          'total_cents', coalesce(pg_catalog.sum(i.total), 0), 'paid_cents', coalesce(pg_catalog.sum(i.paid), 0),
                          'balance_cents', coalesce(pg_catalog.sum(i.total - i.paid), 0)) from inv i),
             'truncated', (select pg_catalog.count(*) > v_limit from inv),
             'credited', (select pg_catalog.jsonb_build_object('count', c.n, 'total_cents', c.cents) from credited c),
             'options', (select o from opts))
           else pg_catalog.jsonb_build_object(
             'view', 'service',
             'rows', coalesce((
               select pg_catalog.jsonb_agg(r.j order by r.issued_on desc, r.seq desc, r.pos)
                 from (select x.issued_on, pg_catalog.split_part(x.number, '-', 2)::int as seq, x.line_position as pos,
                              pg_catalog.jsonb_build_object(
                                'line_id', x.line_id, 'invoice_id', x.invoice_id, 'number', x.number, 'issued_on', x.issued_on,
                                'client_id', x.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                                'professional_name', p.display_name, 'line_type', x.line_type,
                                'service_code', coalesce(s.code, x.service_code), 'service_name', s.name, 'description', x.description,
                                'quantity', x.quantity, 'unit_price_cents', x.unit_price_cents,
                                'subtotal_cents', x.subtotal_cents, 'gst_cents', x.gst_cents, 'qst_cents', x.qst_cents,
                                'total_cents', x.total_cents) as j
                         from lines x
                         left join names cn on cn.client_id = x.client_id
                         left join pros p on p.professional_id = x.professional_id
                         left join svcs s on s.service_id = x.service_id
                        order by x.issued_on desc, pg_catalog.split_part(x.number, '-', 2)::int desc, x.line_position
                        limit v_limit) r), '[]'),
             'by_service', coalesce((
               select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'service_id', g.service_id, 'service_code', g.code, 'service_name', g.name, 'line_type', g.line_type,
                        'lines', g.n, 'quantity', g.qty, 'total_cents', g.total) order by g.total desc, g.code)
                 from (select x.service_id, s.code, s.name, case when x.service_id is null then x.line_type end as line_type,
                              pg_catalog.count(*) as n, pg_catalog.sum(x.quantity) as qty, pg_catalog.sum(x.total_cents) as total
                         from lines x left join svcs s on s.service_id = x.service_id
                        group by x.service_id, s.code, s.name, case when x.service_id is null then x.line_type end) g), '[]'),
             'totals', (select pg_catalog.jsonb_build_object(
                          'count', pg_catalog.count(*), 'quantity', coalesce(pg_catalog.sum(x.quantity), 0),
                          'subtotal_cents', coalesce(pg_catalog.sum(x.subtotal_cents), 0),
                          'gst_cents', coalesce(pg_catalog.sum(x.gst_cents), 0), 'qst_cents', coalesce(pg_catalog.sum(x.qst_cents), 0),
                          'total_cents', coalesce(pg_catalog.sum(x.total_cents), 0)) from lines x),
             'truncated', (select pg_catalog.count(*) > v_limit from lines),
             'credited', (select pg_catalog.jsonb_build_object('count', c.n, 'total_cents', c.cents) from credited c),
             'options', (select o from opts))
           end
      into v_result;
    return v_result;
  end if;

  -- By payment: the payments made in the period, whatever the invoice's date, and the refunds
  -- recorded in the period (L6), as negative rows of their payment's mode.
  with pay as (
    select 'payment'::text as kind, x.payment_id as row_id, x.payment_id, x.paid_on, x.mode_code, x.mode_name,
           x.amount_cents, x.reference, x.invoice_id, x.number, x.client_id, x.payer_client_id, x.professional_ids, x.service_ids
      from private.billing_revenue_payments(v_org, p_from, p_to) x
    union all
    select 'refund'::text, r.refund_id, r.payment_id, r.refunded_on, r.mode_code, r.mode_name,
           -r.amount_cents, null::text, r.invoice_id, r.number, r.client_id, r.payer_client_id, r.professional_ids, r.service_ids
      from private.billing_revenue_refunds(v_org, p_from, p_to) r
  ), names as (
    select n.client_id, n.display_name, n.client_number
      from private.clients_display_names(v_org, array(
             select distinct x.id from (select pay.client_id as id from pay union select pay.payer_client_id from pay) x)) n
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(select distinct u from pay, pg_catalog.unnest(pay.professional_ids) u)) n
  ), svcs as (
    select s.service_id, s.code, s.name
      from private.service_payout_facts(v_org, array(select distinct u from pay, pg_catalog.unnest(pay.service_ids) u)) s
  ), sel as (
    select pay.* from pay
     where (p_mode_code is null or pay.mode_code = p_mode_code)
       and (p_professional_id is null or p_professional_id = any (pay.professional_ids))
       and (p_service_id is null or p_service_id = any (pay.service_ids))
  )
  select pg_catalog.jsonb_build_object(
           'view', 'payment',
           'rows', coalesce((
             select pg_catalog.jsonb_agg(r.j order by r.paid_on desc, r.n desc)
               from (select x.paid_on, pg_catalog.row_number() over (order by x.paid_on, x.kind, x.row_id) as n,
                            pg_catalog.jsonb_build_object(
                              'kind', x.kind, 'row_id', x.row_id,
                              'payment_id', x.payment_id, 'paid_on', x.paid_on, 'invoice_id', x.invoice_id, 'number', x.number,
                              'client_id', x.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                              'payer_name', case when x.payer_client_id <> x.client_id then pn.display_name end,
                              'mode_code', x.mode_code, 'mode_name', x.mode_name, 'amount_cents', x.amount_cents,
                              'reference', x.reference) as j
                       from sel x
                       left join names cn on cn.client_id = x.client_id
                       left join names pn on pn.client_id = x.payer_client_id
                      order by x.paid_on desc, x.kind desc, x.row_id
                      limit v_limit) r), '[]'),
           'by_mode', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('mode_code', g.mode_code, 'mode_name', g.mode_name,
                                                                       'count', g.n, 'amount_cents', g.amount,
                                                                       'refunds_count', g.rn, 'refunds_cents', g.refunded,
                                                                       'net_cents', g.amount - g.refunded)
                                       order by g.amount desc, g.mode_code)
               from (select x.mode_code, x.mode_name,
                            pg_catalog.count(*) filter (where x.kind = 'payment') as n,
                            coalesce(pg_catalog.sum(x.amount_cents) filter (where x.kind = 'payment'), 0) as amount,
                            pg_catalog.count(*) filter (where x.kind = 'refund') as rn,
                            coalesce(-pg_catalog.sum(x.amount_cents) filter (where x.kind = 'refund'), 0) as refunded
                       from sel x group by x.mode_code, x.mode_name) g), '[]'),
           'totals', (select pg_catalog.jsonb_build_object(
                               'count', pg_catalog.count(*) filter (where x.kind = 'payment'),
                               'amount_cents', coalesce(pg_catalog.sum(x.amount_cents) filter (where x.kind = 'payment'), 0),
                               'refunds_count', pg_catalog.count(*) filter (where x.kind = 'refund'),
                               'refunds_cents', coalesce(-pg_catalog.sum(x.amount_cents) filter (where x.kind = 'refund'), 0),
                               'net_cents', coalesce(pg_catalog.sum(x.amount_cents), 0))
                        from sel x),
           'truncated', (select pg_catalog.count(*) > v_limit from sel),
           'options', pg_catalog.jsonb_build_object(
             'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                      order by p.display_name) from pros p), '[]'),
             'services', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.service_id, 'code', s.code, 'name', s.name)
                                                 order by s.code, s.name) from svcs s), '[]'),
             'modes', v_modes))
    into v_result;
  return v_result;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
