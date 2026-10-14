-- =============================================================================
-- Rapports, batch RP2 (the rest after D6): « IVAC » and « Paie »
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §12 (RP2); parity audit L5
-- Legacy:    docs/plans/2026-10-06-legacy-feature-inventory.md §G (`/rapports/ivac`: totals by
--            state, a state filter, sorts, the professional's IVAC number, the client's IVAC file
--            number, the service, the invoice; its CSV was disabled)
-- Decisions: RP-8, RP-9 (decisions log)
--
-- Two definer RPCs, permission first, reading only what Facturation publishes
-- (`private.billing_payer_claim_facts`, `private.billing_payout_facts`) and the names and numbers
-- Clients, Professionnels and Services et tarifs publish:
--   * `report_ivac(from, to, state, professional)` (`reports.finance`, RP-8): per session IVAC
--     covers in the period (and the lines billed to IVAC by hand), what IVAC is billed and where it
--     stands: « À facturer », « En préparation », « Facturée », « Payée en partie », « Payée »; totals per state
--     (whatever the state filter).
--   * `report_payouts(from, to, professional)` (`reports.payroll`, new, admin; RP-9): the payroll
--     summaries (FPay) of the months the period covers, per month and per professional.
-- The period's rules are RP1's (a year at most); at most 5 000 rows (`truncated`).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_rp2', true);

-- RP-9: the payroll is a professional's pay: its own key, admin only by default.
insert into public.permissions (key, module_key, description) values
  ('reports.payroll', 'reports', 'Voir le rapport de paie des professionnels')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'reports.payroll')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- « IVAC » (RP-8)
-- -----------------------------------------------------------------------------
create function public.report_ivac(p_from date, p_to date, p_state text default null, p_professional_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.finance');
  v_limit constant int := 5000;
begin
  perform private.reports_check_period(p_from, p_to);
  if p_state is not null and p_state not in ('to_claim', 'draft', 'claimed', 'partial', 'paid') then
    raise exception 'État inconnu : à facturer, en préparation, facturée, payée en partie ou payée.' using errcode = 'P0001', hint = 'state';
  end if;

  return (
    with f as (
      select * from private.billing_payer_claim_facts(v_org, p_from, p_to) x where x.organisation_kind = 'ivac'
    ), pros as (
      select n.professional_id, n.display_name
        from private.professional_display_names(v_org, array(select distinct f.professional_id from f where f.professional_id is not null)) n
    ), numbers as (
      select n.professional_id, n.number
        from private.professional_payer_numbers_of(v_org, array(select distinct f.professional_id from f where f.professional_id is not null), 'ivac') n
    ), names as (
      select n.client_id, n.display_name, n.client_number
        from private.clients_display_names(v_org, array(select distinct f.client_id from f)) n
    ), files as (
      select c.client_payer_id, c.file_number
        from private.client_payer_facts(v_org, array(select distinct f.client_payer_id from f where f.client_payer_id is not null)) c
    ), svcs as (
      select s.service_id, s.name
        from private.service_payout_facts(v_org, array(select distinct f.service_id from f where f.service_id is not null)) s
    ), scoped as (
      select f.* from f where p_professional_id is null or f.professional_id = p_professional_id
    ), shown as (
      select s.* from scoped s where p_state is null or s.state = p_state
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((
        select pg_catalog.jsonb_agg(r.j order by r.service_on desc, r.line_id)
          from (select s.service_on, s.line_id,
                       pg_catalog.jsonb_build_object(
                         'line_id', s.line_id, 'service_on', s.service_on, 'by_hand', s.by_hand,
                         'client_id', s.client_id, 'client_name', cn.display_name, 'client_number', cn.client_number,
                         'file_number', coalesce(fl.file_number, s.payer_reference),
                         'professional_id', s.professional_id, 'professional_name', p.display_name, 'professional_ivac_number', nb.number,
                         'service_code', s.service_code, 'service_name', coalesce(sv.name, s.description),
                         'amount_cents', s.amount_cents, 'state', s.state,
                         'client_invoice_id', s.client_invoice_id, 'client_invoice_number', s.client_invoice_number,
                         'payer_invoice_id', case when s.state <> 'to_claim' then s.payer_invoice_id end,
                         'payer_invoice_number', case when s.state <> 'to_claim' then s.payer_invoice_number end,
                         'payer_issued_on', case when s.state <> 'to_claim' then s.payer_issued_on end) as j
                  from shown s
                  left join names cn on cn.client_id = s.client_id
                  left join files fl on fl.client_payer_id = s.client_payer_id
                  left join pros p on p.professional_id = s.professional_id
                  left join numbers nb on nb.professional_id = s.professional_id
                  left join svcs sv on sv.service_id = s.service_id
                 order by s.service_on desc, s.line_id
                 limit v_limit) r), '[]'),
      'by_state', (select pg_catalog.jsonb_object_agg(k.state, pg_catalog.jsonb_build_object(
                     'count', (select pg_catalog.count(*) from scoped s where s.state = k.state),
                     'amount_cents', (select coalesce(pg_catalog.sum(s.amount_cents), 0) from scoped s where s.state = k.state)))
                     from (values ('to_claim'), ('draft'), ('claimed'), ('partial'), ('paid')) as k(state)),
      'totals', (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*), 'amount_cents', coalesce(pg_catalog.sum(s.amount_cents), 0))
                   from scoped s),
      'truncated', (select pg_catalog.count(*) > v_limit from shown),
      'options', pg_catalog.jsonb_build_object(
        'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                        order by p.display_name) from pros p), '[]')))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- « Paie » (RP-9)
-- -----------------------------------------------------------------------------
create function public.report_payouts(p_from date, p_to date, p_professional_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.payroll');
  v_limit constant int := 5000;
begin
  perform private.reports_check_period(p_from, p_to);

  return (
    with f as (
      select * from private.billing_payout_facts(v_org, p_from, p_to)
    ), pros as (
      select n.professional_id, n.display_name
        from private.professional_display_names(v_org, array(select distinct f.professional_id from f)) n
    ), scoped as (
      select f.* from f where p_professional_id is null or f.professional_id = p_professional_id
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((
        select pg_catalog.jsonb_agg(r.j order by r.month desc, r.name, r.period_id)
          from (select s.month, coalesce(p.display_name, '') as name, s.period_id,
                       pg_catalog.jsonb_build_object(
                         'period_id', s.period_id, 'month', s.month, 'professional_id', s.professional_id,
                         'professional_name', p.display_name, 'title_name', s.title_name, 'state', s.state,
                         'sessions', s.sessions, 'session_cents', s.session_cents,
                         'late_cancellations', s.late_cancellations, 'late_cancellation_cents', s.late_cancellation_cents,
                         'other_cents', s.other_cents, 'adjustment_cents', s.adjustment_cents, 'total_cents', s.total_cents,
                         'unpriced_count', s.unpriced_count, 'paid_on', s.paid_on) as j
                  from scoped s
                  left join pros p on p.professional_id = s.professional_id
                 order by s.month desc, coalesce(p.display_name, ''), s.period_id
                 limit v_limit) r), '[]'),
      'by_month', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'month', m.month, 'professionals', m.n, 'sessions', m.sessions, 'total_cents', m.total, 'paid_cents', m.paid,
                 'to_pay_cents', m.to_pay, 'not_validated', m.not_validated) order by m.month desc)
          from (select s.month, pg_catalog.count(distinct s.professional_id) as n, pg_catalog.sum(s.sessions) as sessions,
                       pg_catalog.sum(s.total_cents) as total,
                       coalesce(pg_catalog.sum(s.total_cents) filter (where s.state = 'paid'), 0) as paid,
                       coalesce(pg_catalog.sum(s.total_cents) filter (where s.state = 'validated'), 0) as to_pay,
                       pg_catalog.count(*) filter (where s.state not in ('validated', 'paid')) as not_validated
                  from scoped s group by s.month) m), '[]'),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'professional_id', b.professional_id, 'professional_name', p.display_name, 'months', b.n, 'sessions', b.sessions,
                 'total_cents', b.total, 'paid_cents', b.paid) order by p.display_name, b.professional_id)
          from (select s.professional_id, pg_catalog.count(*) as n, pg_catalog.sum(s.sessions) as sessions,
                       pg_catalog.sum(s.total_cents) as total,
                       coalesce(pg_catalog.sum(s.total_cents) filter (where s.state = 'paid'), 0) as paid
                  from scoped s group by s.professional_id) b
          left join pros p on p.professional_id = b.professional_id), '[]'),
      'totals', (select pg_catalog.jsonb_build_object(
                   'periods', pg_catalog.count(*), 'sessions', coalesce(pg_catalog.sum(s.sessions), 0),
                   'total_cents', coalesce(pg_catalog.sum(s.total_cents), 0),
                   'paid_cents', coalesce(pg_catalog.sum(s.total_cents) filter (where s.state = 'paid'), 0),
                   'to_pay_cents', coalesce(pg_catalog.sum(s.total_cents) filter (where s.state = 'validated'), 0),
                   'not_validated', pg_catalog.count(*) filter (where s.state not in ('validated', 'paid')))
                   from scoped s),
      'truncated', (select pg_catalog.count(*) > v_limit from scoped),
      'options', pg_catalog.jsonb_build_object(
        'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                        order by p.display_name) from pros p), '[]')))
  );
end;
$$;

revoke all on function public.report_ivac(date, date, text, uuid), public.report_payouts(date, date, uuid) from public, anon, authenticated;
grant execute on function public.report_ivac(date, date, text, uuid), public.report_payouts(date, date, uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
