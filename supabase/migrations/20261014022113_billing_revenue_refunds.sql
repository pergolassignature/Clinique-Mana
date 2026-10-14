-- =============================================================================
-- Facturation: the refunds Rapports reads for « Revenus » par paiement (parity audit L6)
-- =============================================================================
-- GOrendezvous's « Revenus » par transaction lists the refunds next to the payments. This module
-- publishes them as it publishes the payments (`billing_revenue_payments`, RP1): for definer
-- callers after their own permission check, with the org they verified; granted to no role.
--
-- * `billing_revenue_refunds(org, from, to)`: the refunds recorded (`status = 'recorded'`: done,
--   by hand or confirmed by Stripe) between the two clinic dates, dated by the clinic day they were
--   recorded (`processed_at`, else `created_at`, as the QuickBooks sync dates them), with their
--   payment's mode, the invoice's number and the professionals and services of its lines not
--   credited (for the filters). A refund still with Stripe or refused is not money returned: left
--   out. The reason is never published.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_revenue_refunds', true);

create function private.billing_revenue_refunds(p_org uuid, p_from date, p_to date)
returns table (
  refund_id uuid, refunded_on date, payment_id uuid, mode_code text, mode_name text, amount_cents int,
  invoice_id uuid, number text, client_id uuid, payer_client_id uuid, professional_ids uuid[], service_ids uuid[]
)
language sql
stable
set search_path = ''
as $$
  select r.id, (coalesce(r.processed_at, r.created_at) at time zone coalesce(o.timezone, 'America/Toronto'))::date,
         p.id, p.mode_code, m.name, r.amount_cents,
         i.id, i.number, i.client_id, p.payer_client_id,
         coalesce((select pg_catalog.array_agg(distinct l.professional_id) from public.invoice_lines l
                    where l.org_id = i.org_id and l.invoice_id = i.id and not l.credited and l.professional_id is not null), '{}'),
         coalesce((select pg_catalog.array_agg(distinct l.service_id) from public.invoice_lines l
                    where l.org_id = i.org_id and l.invoice_id = i.id and not l.credited and l.service_id is not null), '{}')
    from public.refunds r
    join public.organizations o on o.id = r.org_id
    join public.payments p on p.org_id = r.org_id and p.id = r.payment_id
    join public.invoices i on i.org_id = r.org_id and i.id = r.invoice_id
    join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
   where r.org_id = p_org and r.status = 'recorded'
     and (coalesce(r.processed_at, r.created_at) at time zone coalesce(o.timezone, 'America/Toronto'))::date between p_from and p_to
   order by 2, r.created_at, r.id
$$;
revoke all on function private.billing_revenue_refunds(uuid, date, date) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
