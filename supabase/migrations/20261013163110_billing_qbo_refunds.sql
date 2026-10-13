-- =============================================================================
-- Facturation, FQ follow-up: refunds and cancellation fees to QuickBooks
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FQ, after F3)
-- Decisions: FQ-11 (refunds), FQ-12 (cancellation fee lines) (decisions log)
-- Needs:     FQ part 2 (`*_billing_qbo_push.sql`), F3 (`refunds`, the outbox kind
--            `payment_refunded`, the `cancellation_fee` lines; `*_billing_follow_up.sql`).
--
-- * Refunds (FQ-11). In the app a refund lowers the invoice's paid amount: the invoice is open
--   again until it is paid or credited (F3). QuickBooks has no negative Payment, and a
--   RefundReceipt would take the amount off the income (a later credit note would then take it
--   off twice). So `payment_refunded` becomes a JournalEntry dated the day of the refund: debit
--   the company's Accounts Receivable account for the payment's customer, credit the account its
--   payment mode was deposited to (`deposit.<code>`). The customer owes the amount again, as in
--   the app; the money leaves the account it came in. It waits for its payment's push. One
--   `qbo_pushes` row (`refund`) and a `requestid` per refund, like the others.
-- * Cancellation fees (FQ-12). A `cancellation_fee` line goes on the item of its service code
--   (`70300` / `70360`, GOrendezvous's « Annulation tardive / absence »), else one made on
--   « Services » (`revenue.services`); its text is the line's own (the percent and the day).
-- Additive: three helpers, one published read, two functions widened (same signatures), the
-- kind check widened.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:billing_qbo_refunds', true);

alter table public.qbo_pushes drop constraint qbo_pushes_kind_check;
alter table public.qbo_pushes add constraint qbo_pushes_kind_check
  check (kind in ('invoice', 'credit_memo', 'payment', 'refund', 'bill'));

-- A refund as QuickBooks needs it (recorded ones only): amount, the day (the clinic's), its payment
-- and invoice. Null otherwise.
create function private.billing_refund_for_sync(p_org uuid, p_refund_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', r.id, 'payment_id', r.payment_id, 'invoice_id', r.invoice_id, 'invoice_number', i.number,
           'amount_cents', r.amount_cents,
           'refunded_on', (coalesce(r.processed_at, r.created_at)
                            at time zone coalesce(o.timezone, 'America/Toronto'))::date)
    from public.refunds r
    join public.invoices i on i.id = r.invoice_id
    join public.organizations o on o.id = r.org_id
   where r.org_id = p_org and r.id = p_refund_id and r.status = 'recorded'
$$;
revoke all on function private.billing_refund_for_sync(uuid, uuid) from public, anon, authenticated, service_role;

-- The company's Accounts Receivable account (the mirror of its chart): the active one, the
-- standard sub-type first. Null when the chart has none (the push then names `receivable`).
create function private.qbo_receivable_account(p_org uuid, p_connection uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select a.qbo_id from public.qbo_accounts a
   where a.org_id = p_org and a.connection_id = p_connection and a.active and a.account_type = 'Accounts Receivable'
   order by (a.account_sub_type = 'AccountsReceivable') desc nulls last, pg_catalog.length(a.qbo_id), a.qbo_id
   limit 1
$$;
revoke all on function private.qbo_receivable_account(uuid, uuid) from public, anon, authenticated, service_role;

-- A line's name when its service has none: by its kind.
create function private.qbo_line_kind_name(p_line_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_line_type
           when 'file_opening' then 'Ouverture de dossier'
           when 'cancellation_fee' then 'Frais d''annulation'
           when 'ivac_gap' then 'Écart IVAC'
           else 'Services' end
$$;
revoke all on function private.qbo_line_kind_name(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- FQ part 2's prepare and record, widened (same signatures)
-- -----------------------------------------------------------------------------
-- What one outbox event needs pushed, or why it waits. p_kind / p_entity / p_invoice: the event's.
-- Answers {action: 'push' | 'done' | 'wait' | 'missing_map' | 'gone' | 'unsupported', ...}; a
-- refund pushes once its payment is in QuickBooks, with the receivable and deposit accounts.
create or replace function public.prepare_qbo_push_for_service(p_org_id uuid, p_kind text, p_entity uuid, p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
  v_push_kind text := case p_kind when 'invoice_issued' then 'invoice' when 'invoice_credited' then 'credit_memo'
                                  when 'payment_recorded' then 'payment' when 'payment_refunded' then 'refund' end;
  v_push public.qbo_pushes;
  v_invoice jsonb;
  v_payment jsonb;
  v_refund jsonb;
  v_payment_push public.qbo_pushes;
  v_receivable text;
  v_payer uuid;
  v_client uuid;
  v_invoice_push public.qbo_pushes;
  v_missing text[] := '{}';
  v_lines jsonb;
begin
  if v_push_kind is null then
    return pg_catalog.jsonb_build_object('action', 'unsupported');
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status = 'connected';
  if v_connection is null then
    return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'not_connected');
  end if;
  select p.* into v_push from public.qbo_pushes p where p.org_id = p_org_id and p.kind = v_push_kind and p.entity_id = p_entity;
  if v_push.status = 'pushed' then
    return pg_catalog.jsonb_build_object('action', 'done', 'qbo_id', v_push.qbo_id);
  end if;
  if v_push.id is not null and (v_push.status = 'failed' or v_push.next_attempt_at > pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'backoff');
  end if;

  v_invoice := private.billing_invoice_for_sync(p_org_id, p_invoice);
  if v_invoice is null then
    return pg_catalog.jsonb_build_object('action', 'gone');
  end if;
  v_payer := (v_invoice ->> 'payer_client_id')::uuid;
  v_client := (v_invoice ->> 'client_id')::uuid;

  if v_push_kind = 'refund' then
    -- A refund (F3, FQ-11): a journal entry on its payment's customer, once its payment is in QuickBooks.
    v_refund := private.billing_refund_for_sync(p_org_id, p_entity);
    if v_refund is null then
      return pg_catalog.jsonb_build_object('action', 'gone');
    end if;
    v_payment := private.billing_payment_for_sync(p_org_id, (v_refund ->> 'payment_id')::uuid);
    if v_payment is null then
      return pg_catalog.jsonb_build_object('action', 'gone');
    end if;
    select p.* into v_payment_push from public.qbo_pushes p
     where p.org_id = p_org_id and p.kind = 'payment' and p.entity_id = (v_refund ->> 'payment_id')::uuid and p.status = 'pushed';
    if v_payment_push.id is null then
      return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'payment_not_pushed');
    end if;
    if private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')) is null then
      v_missing := v_missing || ('deposit.' || (v_payment ->> 'mode_code'));
    end if;
    v_receivable := private.qbo_receivable_account(p_org_id, v_connection);
    if v_receivable is null then
      v_missing := v_missing || 'receivable'::text;
    end if;
    if pg_catalog.cardinality(v_missing) > 0 then
      return pg_catalog.jsonb_build_object('action', 'missing_map', 'keys', pg_catalog.to_jsonb(v_missing));
    end if;
    return pg_catalog.jsonb_build_object(
      'action', 'push',
      'push_kind', 'refund',
      'connection_id', v_connection,
      'attempts', coalesce(v_push.attempts, 0),
      'invoice', v_invoice - 'lines',
      'lines', '[]'::jsonb,
      'payment', v_payment,
      'refund', v_refund,
      'invoice_qbo_id', null,
      'invoice_customer_id', v_payment_push.qbo_customer_id,
      'payer', null, 'dossier', null, 'payer_customer_id', null, 'dossier_customer_id', null,
      'tax_taxable', null, 'tax_exempt', null,
      'receivable_account_id', v_receivable,
      'deposit_account_id', private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')));
  end if;

  if v_push_kind = 'payment' then
    v_payment := private.billing_payment_for_sync(p_org_id, p_entity);
    if v_payment is null then
      return pg_catalog.jsonb_build_object('action', 'gone');
    end if;
    select p.* into v_invoice_push from public.qbo_pushes p
     where p.org_id = p_org_id and p.kind = 'invoice' and p.entity_id = p_invoice and p.status = 'pushed';
    if v_invoice_push.id is null then
      return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'invoice_not_pushed');
    end if;
    if private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')) is null then
      v_missing := v_missing || ('deposit.' || (v_payment ->> 'mode_code'));
    end if;
  else
    if private.qbo_mapped(p_org_id, 'revenue.services') is null then v_missing := v_missing || 'revenue.services'::text; end if;
    if private.qbo_mapped(p_org_id, 'revenue.file_opening') is null then v_missing := v_missing || 'revenue.file_opening'::text; end if;
    if private.qbo_mapped(p_org_id, 'tax.taxable') is null then v_missing := v_missing || 'tax.taxable'::text; end if;
    if private.qbo_mapped(p_org_id, 'tax.exempt') is null then v_missing := v_missing || 'tax.exempt'::text; end if;
    if v_push_kind = 'credit_memo' then
      select p.* into v_invoice_push from public.qbo_pushes p
       where p.org_id = p_org_id and p.kind = 'invoice' and p.entity_id = p_invoice and p.status = 'pushed';
      if v_invoice_push.id is null then
        return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'invoice_not_pushed');
      end if;
    end if;
  end if;
  if pg_catalog.cardinality(v_missing) > 0 then
    return pg_catalog.jsonb_build_object('action', 'missing_map', 'keys', pg_catalog.to_jsonb(v_missing));
  end if;

  -- Each line's item: the company's item for the service code (its SKU, else a name starting
  -- with the code), else one to create on the account of the line's kind.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', l ->> 'id', 'line_type', l ->> 'line_type', 'service_code', l ->> 'service_code',
           'quantity', l -> 'quantity', 'unit_price_cents', l -> 'unit_price_cents', 'subtotal_cents', l -> 'subtotal_cents',
           'total_cents', l -> 'total_cents', 'taxable', (l ->> 'tax_rule') = 'taxable' and not coalesce((v_invoice ->> 'tax_exempt')::boolean, false),
           -- A cancellation fee keeps its own text (the percent and the session's day, F3).
           'description', case when l ->> 'line_type' = 'cancellation_fee' and il.description is not null then il.description
                               else coalesce(s.name, private.qbo_line_kind_name(l ->> 'line_type')) end,
           'item_id', (select i.qbo_id from public.qbo_items i
                        where i.connection_id = v_connection and i.active and l ->> 'service_code' is not null
                          and (i.sku = l ->> 'service_code' or i.name = l ->> 'service_code'
                               or i.name like (l ->> 'service_code') || ' %')
                        order by (i.sku = l ->> 'service_code') desc, pg_catalog.length(i.name), i.qbo_id limit 1),
           'item_name', pg_catalog.left(coalesce(l ->> 'service_code' || ' ', '') || coalesce(s.name,
                          private.qbo_line_kind_name(l ->> 'line_type')), 100),
           'income_account_id', private.qbo_mapped(p_org_id,
                                  case l ->> 'line_type' when 'file_opening' then 'revenue.file_opening' else 'revenue.services' end))
           order by (l ->> 'position')::int), '[]'::jsonb)
    into v_lines
    from pg_catalog.jsonb_array_elements(v_invoice -> 'lines') l
    left join public.services_catalog s on s.org_id = p_org_id and s.id = (l ->> 'service_id')::uuid
    left join public.invoice_lines il on il.org_id = p_org_id and il.id = (l ->> 'id')::uuid;

  return pg_catalog.jsonb_build_object(
    'action', 'push',
    'push_kind', v_push_kind,
    'connection_id', v_connection,
    'attempts', coalesce(v_push.attempts, 0),
    'invoice', v_invoice - 'lines',
    'lines', v_lines,
    'payment', v_payment,
    'invoice_qbo_id', v_invoice_push.qbo_id,
    'invoice_customer_id', v_invoice_push.qbo_customer_id,
    'payer', private.qbo_person(p_org_id, v_payer),
    'dossier', private.qbo_person(p_org_id, v_client),
    'payer_customer_id', (select l.qbo_customer_id from public.qbo_links l
                           where l.connection_id = v_connection and l.kind = 'payer' and l.payer_client_id = v_payer),
    'dossier_customer_id', (select l.qbo_customer_id from public.qbo_links l
                             where l.connection_id = v_connection and l.kind = 'dossier' and l.payer_client_id = v_payer
                               and l.client_id = v_client),
    'tax_taxable', private.qbo_mapped(p_org_id, 'tax.taxable'),
    'tax_exempt', private.qbo_mapped(p_org_id, 'tax.exempt'),
    'deposit_account_id', case when v_payment is not null then private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')) end);
end;
$$;
revoke all on function public.prepare_qbo_push_for_service(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_qbo_push_for_service(uuid, text, uuid, uuid) to service_role;

-- The outcome of one push (p_qbo_id: pushed; else a code: one more try after the backoff, failed
-- after 8). Returns the row's state. Kinds: invoice, credit_memo, payment, refund, bill.
create or replace function public.record_qbo_push_for_service(
  p_org_id uuid,
  p_kind text,
  p_entity uuid,
  p_invoice uuid,
  p_event_id bigint,
  p_qbo_id text,
  p_qbo_customer_id text,
  p_error_code text,
  p_amount_mismatch boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.qbo_pushes;
begin
  if p_kind not in ('invoice', 'credit_memo', 'payment', 'refund', 'bill') or (p_qbo_id is null) = (p_error_code is null) then
    raise exception 'Invalid push outcome' using errcode = '22023';
  end if;
  insert into public.qbo_pushes as q (org_id, kind, entity_id, invoice_id, event_id)
  values (p_org_id, p_kind, p_entity, p_invoice, p_event_id)
  on conflict (org_id, kind, entity_id) do update set event_id = coalesce(excluded.event_id, q.event_id)
  returning * into v;
  if p_qbo_id is not null then
    update public.qbo_pushes q
       set status = 'pushed', qbo_id = p_qbo_id, qbo_customer_id = p_qbo_customer_id, pushed_at = pg_catalog.now(),
           last_error_code = null, amount_mismatch = coalesce(p_amount_mismatch, false), attempts = q.attempts + 1
     where q.id = v.id;
    if p_kind = 'bill' then
      update public.professional_invoices i set qbo_bill_id = p_qbo_id, exported_at = pg_catalog.now()
       where i.org_id = p_org_id and i.id = p_entity and i.qbo_bill_id is null;
    end if;
    return 'pushed';
  end if;
  update public.qbo_pushes q
     set attempts = q.attempts + 1, last_error_code = p_error_code,
         status = case when q.attempts + 1 >= 8 then 'failed' else 'pending' end,
         next_attempt_at = pg_catalog.now() + private.qbo_push_backoff(q.attempts + 1)
   where q.id = v.id
  returning * into v;
  return v.status;
end;
$$;
revoke all on function public.record_qbo_push_for_service(uuid, text, uuid, uuid, bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_qbo_push_for_service(uuid, text, uuid, uuid, bigint, text, text, text, boolean) to service_role;
