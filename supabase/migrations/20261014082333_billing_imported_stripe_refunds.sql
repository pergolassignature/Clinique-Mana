-- =============================================================================
-- Facturation: refunds of imported card payments (BI-29, déléguée — révisable)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14. A card payment imported from GOrendezvous (mode `stripe`, its
--          `external_ref` « gorendezvous:… ») has no PaymentIntent of the clinic's Stripe account:
--          « Rembourser » left a pending Stripe refund that the job then failed
--          (`not_refundable_online`, « Remboursement refusé »).
--
-- * `refund_payment` refuses an imported card payment (French P0001 naming the other action).
-- * `record_refund_outside_app(payment, cents, reason, reference)` (`billing.manage` first): the
--   clinic refunded it itself (bank transfer, or Stripe's dashboard of the account GOrendezvous
--   used); recorded at once, with its reference in `refunds.provider_ref`. Only for an imported
--   card payment: the other modes are already recorded at once by « Rembourser », and an app card
--   payment is refunded by Stripe. The same path as every manual refund
--   (`private.billing_refund_recorded`: the paid amount lowered, QuickBooks' outbox told, which
--   skips an imported invoice: GOrendezvous's invoices are not the app's in QuickBooks), the same
--   audit (`refunds_audit`, the reason redacted).
-- * `get_invoice` (same signature): each payment says whether it was imported (`imported`), each
--   refund gives its reference (`reference`).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_imported_stripe_refunds', true);

-- -----------------------------------------------------------------------------
-- refund_payment: never an online refund of an imported card payment
-- -----------------------------------------------------------------------------
-- Latest body: 20261014071522_billing_import_credit_notes.sql.
create or replace function public.refund_payment(p_payment_id uuid, p_amount_cents int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  p public.payments;
  v_left int;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  select x.* into p from public.payments x where x.org_id = v_org and x.id = p_payment_id for update;
  if p.id is null then
    raise exception 'Paiement introuvable.' using errcode = 'P0001', hint = 'payment_id';
  end if;
  -- An imported card payment has no PaymentIntent of the clinic's Stripe: refunded outside the app,
  -- recorded with record_refund_outside_app (BI-29), never a Stripe refund that fails.
  if p.mode_code = 'stripe' and coalesce(p.external_ref, '') like 'gorendezvous:%' then
    raise exception 'Ce paiement par carte vient de GOrendezvous : l''app ne peut pas le rembourser par Stripe. Remboursez-le hors de l''app, puis enregistrez-le avec « Remboursement fait hors de l''app ».'
      using errcode = 'P0001', hint = 'payment_id';
  end if;
  if p.mode_code = 'credit_note' then
    raise exception 'Un crédit importé de GOrendezvous (note de crédit) ne se rembourse pas.' using errcode = 'P0001', hint = 'payment_id';
  end if;
  v_left := p.amount_cents - coalesce((select sum(r.amount_cents) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_left then
    raise exception 'Le remboursement va de 0,01 $ à ce qui reste du paiement (%).', private.billing_format_money(v_left)
      using errcode = 'P0001', hint = 'amount';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) not between 3 and 500 then
    raise exception 'La raison du remboursement compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status, created_by)
  values (v_org, p.id, p.invoice_id, p_amount_cents, v_reason,
          'pending_provider', auth.uid())
  returning id into v_id;
  -- Every mode but a card through Stripe is refunded by the clinic itself: recorded at once.
  if p.mode_code <> 'stripe' then
    perform private.billing_refund_recorded(v_org, v_id);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- record_refund_outside_app: an imported card payment refunded by the clinic itself
-- -----------------------------------------------------------------------------
create function public.record_refund_outside_app(p_payment_id uuid, p_amount_cents int, p_reason text, p_reference text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  p public.payments;
  v_left int;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_reference text := nullif(pg_catalog.btrim(coalesce(p_reference, '')), '');
  v_id uuid;
begin
  select x.* into p from public.payments x where x.org_id = v_org and x.id = p_payment_id for update;
  if p.id is null then
    raise exception 'Paiement introuvable.' using errcode = 'P0001', hint = 'payment_id';
  end if;
  if p.mode_code <> 'stripe' or coalesce(p.external_ref, '') not like 'gorendezvous:%' then
    raise exception 'Seul un paiement par carte importé de GOrendezvous se rembourse ici hors de l''app ; les autres passent par « Rembourser ».'
      using errcode = 'P0001', hint = 'payment_id';
  end if;
  v_left := p.amount_cents - coalesce((select sum(r.amount_cents) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_left then
    raise exception 'Le remboursement va de 0,01 $ à ce qui reste du paiement (%).', private.billing_format_money(v_left)
      using errcode = 'P0001', hint = 'amount';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) not between 3 and 500 then
    raise exception 'La raison du remboursement compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  if v_reference is null or pg_catalog.char_length(v_reference) not between 3 and 200 then
    raise exception 'Indiquez la référence du remboursement (virement, Stripe…), de 3 à 200 caractères.'
      using errcode = 'P0001', hint = 'reference';
  end if;
  insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status, provider_ref, created_by, processed_at)
  values (v_org, p.id, p.invoice_id, p_amount_cents, v_reason, 'recorded', v_reference, auth.uid(), pg_catalog.now())
  returning id into v_id;
  -- As every manual refund: the paid amount lowered, QuickBooks' outbox told.
  perform private.billing_refund_recorded(v_org, v_id);
  return v_id;
end;
$$;
revoke all on function public.record_refund_outside_app(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.record_refund_outside_app(uuid, int, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- get_invoice: `imported` on each payment, `reference` on each refund (same signature)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013205523_billing_payer_guards.sql.
create or replace function public.get_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v public.invoices;
begin
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id;
  if v.id is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'invoice', pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object('hold_now', case when v.status = 'draft' then private.billing_hold_now(v) end,
                                                                       'payer_has_email', private.billing_invoice_payer_email(v) is not null),
    'client', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                 from private.clients_billing_facts(v_org, array[v.client_id]) f),
    'payer', case when v.payer_kind = 'organisation' then (
               select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'client_number', null, 'kind', o.kind,
                                                    'billing_email', o.billing_email)
                 from public.payer_organisations o where o.id = v.payer_organisation_id)
             else (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                     from private.clients_billing_facts(v_org, array[v.payer_client_id]) f) end,
    'payer_options', case when v.payer_kind = 'organisation' then '[]'::jsonb else private.billing_payer_options(v_org, v.client_id) end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.position) from public.invoice_lines l where l.invoice_id = v.id), '[]'::jsonb),
    'credit_note', (select pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object('deliveries', private.billing_delivery_list(v_org, 'credit_note', c.id))
                      from public.credit_notes c where c.invoice_id = v.id),
    'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', p.id, 'mode_code', p.mode_code, 'mode', m.name, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                  'reference', p.reference, 'note', p.note, 'receipt_id', r.id, 'receipt_number', r.number, 'receipt_file_id', r.pdf_file_id,
                  'receipt_deliveries', private.billing_delivery_list(v_org, 'receipt', r.id),
                  'refunds', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', f.id, 'amount_cents', f.amount_cents, 'reason', f.reason, 'status', f.status,
                                'reference', f.provider_ref,
                                'created_at', f.created_at) order by f.created_at)
                                from public.refunds f where f.payment_id = p.id), '[]'::jsonb),
                  'imported', coalesce(p.external_ref, '') like 'gorendezvous:%',
                  'refundable_cents', p.amount_cents - coalesce((select sum(f.amount_cents) from public.refunds f
                                                                  where f.payment_id = p.id and f.status <> 'failed'), 0))
                  order by p.paid_on, p.created_at)
                  from public.payments p
                  join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
                  left join public.receipts r on r.payment_id = p.id
                 where p.invoice_id = v.id), '[]'::jsonb),
    'deliveries', private.billing_delivery_list(v_org, 'invoice', v.id),
    'reminders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'step', r.step, 'run_on', r.run_on, 'sent', r.delivery_id is not null,
                    'email_status', (select d.email_status from public.billing_deliveries d where d.id = r.delivery_id))
                    order by r.step)
                    from public.billing_dunning_runs r where r.invoice_id = v.id), '[]'::jsonb),
    'fee', (select pg_catalog.jsonb_build_object('appointment_id', c.appointment_id, 'kind', c.kind, 'decided_as', c.decided_as)
              from public.cancellation_fee_decisions c where c.invoice_id = v.id),
    'payment_modes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', m.code, 'name', m.name) order by m.sort_order)
                                 from public.payment_modes m where m.org_id = v_org and m.is_active and m.code <> 'credit_note'), '[]'::jsonb));
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
