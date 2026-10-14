-- =============================================================================
-- Facturation: the facts Rapports reads for RP2's « IVAC » and « Paie » reports, published as
-- private helpers
-- =============================================================================
-- Rapports (plan §12, RP2) shows what IVAC is billed and paid per session, as legacy's
-- `/rapports/ivac`, and the payroll per month and professional, without reading this module's
-- tables (CLAUDE.md §5). For definer callers after their own permission check, with the org they
-- verified; granted to no role; read only. Additive: no existing object changes (lane C, billing's
-- owner, told).
--
-- * `billing_payer_claim_facts(org, from, to)`: what a third-party payer (IVAC or a PAE) is
--   billed for the sessions between two clinic dates (inclusive):
--   - one row per payer's share (`payer_share`, not credited, on an issued client invoice) whose
--     session is in the period, with the session's service (the client invoice's service line for
--     that appointment), the client invoice, and the live claim (`payer_claim`, not credited) that
--     bills it to the payer, if any, with the payer invoice;
--   - one row per line made by hand on an issued organisation's invoice (report writing billed to
--     IVAC, FP-3), dated by its service date or else the invoice's date;
--   - `state`: `to_claim` (no live claim: a credited payer invoice frees its shares), `draft`
--     (claimed on a payer invoice not sent yet), `claimed` (the payer invoice issued, nothing
--     paid), `partial` (part of it paid), `paid` (paid in full). What is paid is the invoice's
--     `paid_cents`, already net of refunds (lane C's review).
-- * `billing_payout_facts(org, from_month, to_month)`: one row per payroll period (FPay) of the
--   months between the two (first days), with its counts and amounts per kind of line.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_rp2_report_facts', true);

create function private.billing_payer_claim_facts(p_org uuid, p_from date, p_to date)
returns table (
  organisation_id uuid, organisation_kind text, organisation_name text, line_id uuid, by_hand boolean, service_on date,
  appointment_id uuid, client_id uuid, client_payer_id uuid, professional_id uuid, service_id uuid, service_code int,
  description text, amount_cents int, client_invoice_id uuid, client_invoice_number text, claim_line_id uuid,
  payer_invoice_id uuid, payer_invoice_number text, payer_invoice_status text, payer_issued_on date, payer_reference text,
  payer_total_cents int, payer_paid_cents int, state text
)
language sql
stable
set search_path = ''
as $$
  with shares as (
    select l.id, l.payer_organisation_id, l.service_on, l.appointment_id, i.client_id, l.client_payer_id, l.professional_id,
           -l.total_cents as amount, i.id as invoice_id, i.number
      from public.invoice_lines l
      join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
     where l.org_id = p_org and l.line_type = 'payer_share' and not l.credited and i.status = 'issued'
       and l.service_on between p_from and p_to
  ), share_rows as (
    select s.payer_organisation_id, s.id, false as by_hand, s.service_on, s.appointment_id, s.client_id, s.client_payer_id,
           s.professional_id, sl.service_id, sl.service_code, sl.description, s.amount, s.invoice_id, s.number,
           c.id as claim_id, c.invoice_id as payer_invoice_id
      from shares s
      left join lateral (select x.service_id, x.service_code, x.description
                           from public.invoice_lines x
                          where x.org_id = p_org and x.invoice_id = s.invoice_id and x.appointment_id = s.appointment_id
                            and x.line_type = 'service'
                          order by x.position
                          limit 1) sl on true
      left join lateral (select y.id, y.invoice_id
                           from public.invoice_lines y
                          where y.org_id = p_org and y.source_line_id = s.id and not y.credited
                          order by y.created_at desc
                          limit 1) c on true
  ), hand_rows as (
    select i.payer_organisation_id, l.id, true as by_hand, coalesce(l.service_on, i.issued_on) as service_on, l.appointment_id,
           i.client_id, null::uuid as client_payer_id, l.professional_id, l.service_id, l.service_code, l.description,
           l.total_cents as amount, null::uuid as invoice_id, null::text as number, l.id as claim_id, i.id as payer_invoice_id
      from public.invoice_lines l
      join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
     where l.org_id = p_org and i.payer_kind = 'organisation' and i.status = 'issued' and not l.credited
       and l.line_type <> 'payer_claim'
       and coalesce(l.service_on, i.issued_on) between p_from and p_to
  ), r as (
    select * from share_rows union all select * from hand_rows
  )
  select o.id, o.kind, o.name, r.id, r.by_hand, r.service_on, r.appointment_id, r.client_id, r.client_payer_id, r.professional_id,
         r.service_id, r.service_code, r.description, r.amount, r.invoice_id, r.number, r.claim_id,
         p.id, p.number, p.status, p.issued_on, p.payer_reference, p.total_cents, p.paid_cents,
         case when r.claim_id is null then 'to_claim'
              when p.status = 'draft' then 'draft'
              when p.paid_cents >= p.total_cents then 'paid'
              when p.paid_cents > 0 then 'partial'
              else 'claimed' end
    from r
    join public.payer_organisations o on o.org_id = p_org and o.id = r.payer_organisation_id
    left join public.invoices p on p.org_id = p_org and p.id = r.payer_invoice_id
   order by r.service_on, r.id
$$;

create function private.billing_payout_facts(p_org uuid, p_from_month date, p_to_month date)
returns table (
  period_id uuid, professional_id uuid, month date, state text, title_name text, lines_count int, unpriced_count int,
  total_cents int, sessions int, session_cents bigint, late_cancellations int, late_cancellation_cents bigint,
  other_cents bigint, adjustment_cents bigint, sent_at timestamptz, validated_at timestamptz, paid_on date
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.professional_id, p.month, p.state, p.title_name, p.lines_count, p.unpriced_count, p.total_cents,
         (pg_catalog.count(l.id) filter (where l.kind = 'session'))::int,
         coalesce(pg_catalog.sum(l.amount_cents) filter (where l.kind = 'session'), 0)::bigint,
         (pg_catalog.count(l.id) filter (where l.kind = 'late_cancellation'))::int,
         coalesce(pg_catalog.sum(l.amount_cents) filter (where l.kind = 'late_cancellation'), 0)::bigint,
         coalesce(pg_catalog.sum(l.amount_cents) filter (where l.kind in ('other_fees', 'workshop')), 0)::bigint,
         coalesce(pg_catalog.sum(l.amount_cents) filter (where l.kind = 'adjustment'), 0)::bigint,
         p.sent_at, p.validated_at, p.paid_on
    from public.payout_periods p
    left join public.payout_lines l on l.org_id = p.org_id and l.period_id = p.id
   where p.org_id = p_org
     and p.month between pg_catalog.date_trunc('month', p_from_month)::date and pg_catalog.date_trunc('month', p_to_month)::date
   group by p.id
   order by p.month, p.professional_id
$$;

revoke all on function private.billing_payer_claim_facts(uuid, date, date), private.billing_payout_facts(uuid, date, date)
  from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
