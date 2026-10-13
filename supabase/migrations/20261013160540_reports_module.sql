-- =============================================================================
-- Module Rapports (« reports »), batch RP1: « Revenus », « Annulations et absences »,
-- « Clients à relancer »
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §1 (catalogue), §12 (RP1)
-- Data:      docs/research/2026-10-11-gorendezvous-tour.md (Revenus: by invoice, by service, by
--            payment; cancellations by reason; clients to call back)
-- Decisions: R-27, RP-1 … RP-6 (decisions log)
--
-- The `reports` module has no table: it reads only what Facturation and Rendez-vous publish
-- (`private.billing_revenue_lines`, `billing_revenue_payments`, `billing_payment_mode_names`;
-- `private.appointment_absence_facts`, `cancellation_reason_names`) and the names Clients,
-- Professionnels and Services et tarifs publish, through three definer RPCs that check the
-- permission first:
--   * `report_revenue(view, from, to, professional, service, mode)` (`reports.finance`, RP-2):
--     `invoice` (one row per invoice issued in the period and not credited: totals, paid,
--     balance), `service` (one row per line, and the totals per service), `payment` (one row per
--     payment made in the period, and the totals per mode). The invoices credited are counted
--     apart (GOrendezvous exports only the invoices not cancelled).
--   * `report_cancellations(from, to, professional, reason, kind)` (`reports.view`, RP-3): the
--     cancellations (with their reason, late or not) and the absences, per reason.
--   * `report_clients_to_follow_up(from, to, professional)` (`reports.view`, RP-4): per client,
--     the last cancellation or absence of the period with nothing booked after it, files open.
-- A period goes from a clinic date to another, a year at most (RP-5); at most 5 000 rows come
-- back (`truncated`), the totals always count everything. The CSV is made in the browser from
-- the answer (plan §12: no file stored).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_module', true);

-- -----------------------------------------------------------------------------
-- Registry (RP-1): admin both; the adjointe the revenue (she bills); disabled until switched on.
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('reports', 'Rapports')
on conflict do nothing;

insert into public.module_dependencies (module_key, depends_on) values
  ('reports', 'billing'),
  ('reports', 'appointments')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('reports.view',    'reports', 'Voir les rapports d''activité (annulations, absences, clients à relancer)'),
  ('reports.finance', 'reports', 'Voir les rapports financiers (revenus)')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin',           'reports.view'),
  ('admin',           'reports.finance'),
  ('admin_assistant', 'reports.finance')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create function private.reports_require(p_permission text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_permission) then
    raise exception 'Permission refusée : %', p_permission using errcode = '42501';
  end if;
  return private.current_user_org_id();
end;
$$;

-- RP-5: a period from a clinic date to another, a year at most.
create function private.reports_check_period(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choisissez une période : du … au …, la fin après le début.' using errcode = 'P0001', hint = 'period';
  end if;
  if p_to - p_from > 366 then
    raise exception 'La période va jusqu''à un an : choisissez-en une plus courte.' using errcode = 'P0001', hint = 'period';
  end if;
end;
$$;

-- The instants of a clinic period: [from 00:00, the day after to 00:00) in the clinic's zone.
create function private.reports_period_bounds(p_org uuid, p_from date, p_to date, out starts_at timestamptz, out ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select p_from::timestamp at time zone z, (p_to + 1)::timestamp at time zone z
    from (select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto') as z) t
$$;

revoke all on function private.reports_require(text), private.reports_check_period(date, date),
  private.reports_period_bounds(uuid, date, date)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- « Revenus » (RP-2)
-- -----------------------------------------------------------------------------
create function public.report_revenue(
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

  -- By payment: the payments made in the period, whatever the invoice's date.
  with pay as (
    select * from private.billing_revenue_payments(v_org, p_from, p_to)
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
               from (select x.paid_on, pg_catalog.row_number() over (order by x.paid_on, x.payment_id) as n,
                            pg_catalog.jsonb_build_object(
                              'payment_id', x.payment_id, 'paid_on', x.paid_on, 'invoice_id', x.invoice_id, 'number', x.number,
                              'client_id', x.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                              'payer_name', case when x.payer_client_id <> x.client_id then pn.display_name end,
                              'mode_code', x.mode_code, 'mode_name', x.mode_name, 'amount_cents', x.amount_cents,
                              'reference', x.reference) as j
                       from sel x
                       left join names cn on cn.client_id = x.client_id
                       left join names pn on pn.client_id = x.payer_client_id
                      order by x.paid_on desc, x.payment_id
                      limit v_limit) r), '[]'),
           'by_mode', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('mode_code', g.mode_code, 'mode_name', g.mode_name,
                                                                       'count', g.n, 'amount_cents', g.amount) order by g.amount desc)
               from (select x.mode_code, x.mode_name, pg_catalog.count(*) as n, pg_catalog.sum(x.amount_cents) as amount
                       from sel x group by x.mode_code, x.mode_name) g), '[]'),
           'totals', (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*), 'amount_cents', coalesce(pg_catalog.sum(x.amount_cents), 0))
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

-- -----------------------------------------------------------------------------
-- « Annulations et absences » (RP-3)
-- -----------------------------------------------------------------------------
create function public.report_cancellations(
  p_from date, p_to date, p_professional_id uuid default null, p_reason_id uuid default null, p_kind text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.view');
  v_limit constant int := 5000;
  v_bounds record;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  if p_kind is not null and p_kind not in ('cancelled', 'absent') then
    raise exception 'Type inconnu : annulation ou absence.' using errcode = 'P0001', hint = 'kind';
  end if;
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);

  with f_all as (
    select * from private.appointment_absence_facts(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), f as (
    select * from f_all
     where (p_professional_id is null or f_all.professional_id = p_professional_id)
       and (p_kind is null or f_all.kind = p_kind)
       and (p_reason_id is null or f_all.reason_id = p_reason_id)
  ), names as (
    select n.client_id, n.display_name, n.client_number
      from private.clients_display_names(v_org, array(select distinct f.client_id from f)) n
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(select distinct f_all.professional_id from f_all)) n
  ), svcs as (
    select s.service_id, s.code, s.name
      from private.service_payout_facts(v_org, array(select distinct f.service_id from f where f.service_id is not null)) s
  ), appts as (
    -- One per appointment (a couple's counts once).
    select distinct on (f.appointment_id) f.* from f order by f.appointment_id, f.role
  )
  select pg_catalog.jsonb_build_object(
           'rows', coalesce((
             select pg_catalog.jsonb_agg(r.j order by r.starts_at desc, r.appointment_id, r.role)
               from (select x.starts_at, x.appointment_id, x.role,
                            pg_catalog.jsonb_build_object(
                              'appointment_id', x.appointment_id, 'starts_at', x.starts_at, 'kind', x.kind,
                              'client_id', x.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                              'professional_name', p.display_name, 'service_code', s.code, 'service_name', s.name,
                              'reason_name', x.reason_name, 'late', x.cancel_late, 'kept_on_schedule', x.kept_on_schedule,
                              'cancelled_at', x.cancelled_at, 'later_starts_at', x.later_starts_at) as j
                       from f x
                       left join names cn on cn.client_id = x.client_id
                       left join pros p on p.professional_id = x.professional_id
                       left join svcs s on s.service_id = x.service_id
                      order by x.starts_at desc, x.appointment_id, x.role
                      limit v_limit) r), '[]'),
           'by_reason', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', g.kind, 'reason_id', g.reason_id, 'reason_name', g.reason_name,
                                                                       'count', g.n, 'late', g.late)
                                         order by g.n desc, g.kind, g.reason_name)
               from (select a.kind, a.reason_id, a.reason_name, pg_catalog.count(*) as n,
                            pg_catalog.count(*) filter (where a.cancel_late) as late
                       from appts a group by a.kind, a.reason_id, a.reason_name) g), '[]'),
           'totals', (select pg_catalog.jsonb_build_object(
                        'cancelled', pg_catalog.count(*) filter (where a.kind = 'cancelled'),
                        'late', pg_catalog.count(*) filter (where a.cancel_late),
                        'absent', pg_catalog.count(*) filter (where a.kind = 'absent'))
                        from appts a),
           'truncated', (select pg_catalog.count(*) > v_limit from f),
           'options', pg_catalog.jsonb_build_object(
             'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                      order by p.display_name) from pros p), '[]'),
             'reasons', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.reason_id, 'name', r.name)
                                                order by r.sort_order, r.name)
                                    from private.cancellation_reason_names(v_org) r), '[]')))
    into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- « Clients à relancer » (RP-4)
-- -----------------------------------------------------------------------------
create function public.report_clients_to_follow_up(p_from date, p_to date, p_professional_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.view');
  v_limit constant int := 5000;
  v_bounds record;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);

  with f_all as (
    select * from private.appointment_absence_facts(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), f as (
    -- Nothing booked after it, whoever the professional.
    select * from f_all
     where f_all.later_starts_at is null
       and (p_professional_id is null or f_all.professional_id = p_professional_id)
  ), latest as (
    select distinct on (f.client_id) f.*, pg_catalog.count(*) over (partition by f.client_id) as events
      from f order by f.client_id, f.starts_at desc
  ), files as (
    select b.client_id, b.display_name, b.client_number
      from private.clients_billing_facts(v_org, array(select latest.client_id from latest)) b
     where b.found and not b.is_archived and not b.is_closed
  ), keep as (
    select l.*, c.display_name, c.client_number from latest l join files c on c.client_id = l.client_id
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(select distinct f_all.professional_id from f_all)) n
  ), svcs as (
    select s.service_id, s.code, s.name
      from private.service_payout_facts(v_org, array(select distinct k.service_id from keep k where k.service_id is not null)) s
  )
  select pg_catalog.jsonb_build_object(
           'rows', coalesce((
             select pg_catalog.jsonb_agg(r.j order by r.starts_at desc, r.client_id)
               from (select k.starts_at, k.client_id,
                            pg_catalog.jsonb_build_object(
                              'client_id', k.client_id, 'client_name', k.display_name, 'client_number', k.client_number,
                              'starts_at', k.starts_at, 'kind', k.kind, 'reason_name', k.reason_name, 'late', k.cancel_late,
                              'professional_name', p.display_name, 'service_code', s.code, 'service_name', s.name,
                              'events', k.events) as j
                       from keep k
                       left join pros p on p.professional_id = k.professional_id
                       left join svcs s on s.service_id = k.service_id
                      order by k.starts_at desc, k.client_id
                      limit v_limit) r), '[]'),
           'total', (select pg_catalog.count(*) from keep),
           'truncated', (select pg_catalog.count(*) > v_limit from keep),
           'options', pg_catalog.jsonb_build_object(
             'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                      order by p.display_name) from pros p), '[]')))
    into v_result;
  return v_result;
end;
$$;

revoke all on function public.report_revenue(text, date, date, uuid, uuid, text),
  public.report_cancellations(date, date, uuid, uuid, text),
  public.report_clients_to_follow_up(date, date, uuid)
  from public, anon;
grant execute on function public.report_revenue(text, date, date, uuid, uuid, text),
  public.report_cancellations(date, date, uuid, uuid, text),
  public.report_clients_to_follow_up(date, date, uuid)
  to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
