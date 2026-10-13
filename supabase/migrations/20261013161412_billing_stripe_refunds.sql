-- =============================================================================
-- Facturation: Stripe refunds (batch FS, part 2; FS-8, FS-9)
-- =============================================================================
-- F3 (`20261013140557_billing_follow_up`) records a refund on a payment (`refund_payment`):
-- every mode but `stripe` is recorded at once; a Stripe payment's refund waits as
-- `pending_provider` until the card is refunded. This migration lets FS's functions do that:
--   * `stripe_refunds_due_for_service(org, limit)`: the pending refunds of Stripe payments,
--     oldest first, with the PaymentIntent (the payment's `external_ref`), while Facturation is
--     open to everyone (P3-40: a module reserved for its testers moves no money);
--   * `stripe_refund_for_service(org, refund)`: one of them (« Rembourser », right after the
--     staff's refund), or null when it is settled or not a Stripe one;
--   * `settle_stripe_refund_for_service(org, refund, ok, provider_ref, error_code)` → boolean:
--     F3's `finish_refund_for_service` (a success lowers the invoice's paid amount and goes to
--     QuickBooks' outbox), false when already settled (the webhook and the call that made it may
--     both arrive: settled once); a failure tells `billing.manage` (« Remboursement refusé »).
--   * The job `billing.stripe_refunds` (`billing-stripe-refunds`, every 10 minutes, off until
--     switched on): the refunds a call did not finish (a network failure, Stripe's « pending »).
-- The refund at Stripe is made once per refund (`Idempotency-Key: refund:<id>`) with the refund's
-- id in its metadata; Stripe's `charge.refunded` and `refund.updated` events settle the ones
-- still pending. Service RPCs: granted to service_role only.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_stripe_refunds', true);

create function public.stripe_refunds_due_for_service(p_org_id uuid, p_limit int default 25)
returns table (refund_id uuid, amount_cents int, payment_intent_id text, invoice_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.amount_cents, p.external_ref, r.invoice_id
    from public.refunds r
    join public.payments p on p.org_id = r.org_id and p.id = r.payment_id
   where r.org_id = p_org_id and r.status = 'pending_provider' and p.mode_code = 'stripe'
     and public.module_open_to_all_for_org(p_org_id, 'billing')
   order by r.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

create function public.stripe_refund_for_service(p_org_id uuid, p_refund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('refund_id', r.id, 'amount_cents', r.amount_cents,
                                       'payment_intent_id', p.external_ref, 'invoice_id', r.invoice_id,
                                       'module_open', public.module_open_to_all_for_org(p_org_id, 'billing'))
    from public.refunds r
    join public.payments p on p.org_id = r.org_id and p.id = r.payment_id
   where r.org_id = p_org_id and r.id = p_refund_id and r.status = 'pending_provider' and p.mode_code = 'stripe'
$$;

create function public.settle_stripe_refund_for_service(
  p_org_id uuid, p_refund_id uuid, p_ok boolean, p_provider_ref text, p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds;
  v_number text;
begin
  select x.* into r from public.refunds x
   where x.org_id = p_org_id and x.id = p_refund_id
   for update;
  if r.id is null or r.status <> 'pending_provider' then
    return false;
  end if;
  perform public.finish_refund_for_service(p_org_id, p_refund_id, p_ok, p_provider_ref, p_error_code);
  if not p_ok then
    select i.number into v_number from public.invoices i where i.id = r.invoice_id;
    perform private.notify(p_org_id, 'billing', 'billing.refund_failed', 'important', 'Remboursement refusé',
                           'Stripe n''a pas fait le remboursement de ' || private.billing_format_money(r.amount_cents)
                           || ' sur la facture ' || coalesce(v_number, '') || ' : rien n''est remboursé.',
                           '/facturation/factures/' || r.invoice_id::text, 'invoice', r.invoice_id,
                           'billing.manage', null, 'billing.refund_failed:' || r.id::text, null);
  end if;
  return true;
end;
$$;

revoke all on function public.stripe_refunds_due_for_service(uuid, int), public.stripe_refund_for_service(uuid, uuid),
  public.settle_stripe_refund_for_service(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.stripe_refunds_due_for_service(uuid, int), public.stripe_refund_for_service(uuid, uuid),
  public.settle_stripe_refund_for_service(uuid, uuid, boolean, text, text)
  to service_role;

-- The job: the refunds a call left pending.
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('billing.stripe_refunds', 'billing', 'Remboursements par Stripe',
   'Toutes les 10 minutes, fait chez Stripe les remboursements de paiements par carte qui attendent encore (aussitôt fait d''habitude, au moment du remboursement).',
   'function', 'billing-stripe-refunds', null, 'billing.stripe_refunds', null, false)
on conflict do nothing;
select cron.schedule('billing.stripe_refunds', '*/10 * * * *', $$select private.invoke_job_function('billing.stripe_refunds')$$);

select pg_catalog.set_config('app.audit_source', '', true);
