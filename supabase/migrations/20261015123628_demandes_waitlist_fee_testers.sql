-- =============================================================================
-- Demandes × Facturation: « Facturer l'inscription » while Demandes is reserved for its testers
-- =============================================================================
-- Asked:     Jonathan, 2026-10-15 (production: the testers could not try the waitlist fee, runbook A7)
-- Decisions: D-52 (decisions log; P3-40, BI-19)
--
-- Before, `invoice_waitlist_fee` refused (`module_reserved`) while Demandes was « Réservé aux
-- testeurs ». Now it behaves like Facturation for its testers: the invoice is made and finalised as
-- always (its number, its PDF, the entry « Facturés »); only its email to the client is held.
-- * `private.billing_source_sends_held(org, source_type)`: whether the module that owns an invoice
--   source (`billing_source_hooks.module_key`: data, not code, ADR 0003) is enabled and reserved for
--   its testers (`private.module_sends_held`). Granted to no role.
-- * `private.billing_create_waitlist_fee_invoice` queues its delivery without email
--   (`send_email = false`: the PDF only) while that holds.
-- * `billing_document_for_service` (the deliveries' choke point) skips the email (`reserved`) of
--   every document of such an invoice: « Renvoyer au payeur », a reminder, a receipt, a credit
--   note. So no email of a waitlist fee reaches a client while Demandes is reserved, even with
--   Facturation open to all. Statements (per client, typed in Facturation) stay Facturation's own.
-- * `stripe_charges_due_for_service` (the next-day card charge) skips such an invoice too.
-- * `invoice_waitlist_fee` no longer refuses for P3-40 and answers jsonb `{ number, email_held_by }`
--   (`demandes`, `billing` when Facturation is the reserved one, or null) for the toast. Its return
--   type changes: dropped and created again, same grants.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist_fee_testers', true);

-- -----------------------------------------------------------------------------
-- 1. Whether an invoice source's module holds its sends
-- -----------------------------------------------------------------------------
create function private.billing_source_sends_held(p_org uuid, p_source_type text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_source_hooks h
     where h.source_type = p_source_type
       and public.module_enabled_for_org(p_org, h.module_key)
       and private.module_sends_held(p_org, h.module_key))
$$;
revoke all on function private.billing_source_sends_held(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The waitlist fee's invoice: its email queued only when Demandes is open to all
-- -----------------------------------------------------------------------------
create or replace function private.billing_create_waitlist_fee_invoice(p_org uuid, p_client_id uuid, p_entry_id uuid, p_actor uuid,
                                                                       out invoice_id uuid, out number text)
language plpgsql
set search_path = ''
as $$
declare
  v_service uuid := private.service_id_by_key(p_org, 'waitlist_registration');
  v_today date := private.billing_today(p_org);
begin
  if v_service is null then
    raise exception 'Le service « Inscription à la liste d''attente » n''existe pas dans Services et tarifs.' using errcode = 'P0001', hint = 'service';
  end if;
  -- One entry at a time: two clicks never make two invoices.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.waitlist_fee:' || p_entry_id::text, 0));
  if exists (select 1 from public.invoices i
              where i.org_id = p_org and i.source_type = 'waitlist_fee' and i.source_id = p_entry_id and i.status <> 'credited') then
    raise exception 'Les frais de cette inscription sont déjà facturés.' using errcode = 'P0001', hint = 'fee_status';
  end if;
  invoice_id := private.billing_new_invoice(p_org, p_client_id, null, 'waitlist_fee', p_entry_id, p_actor);
  perform private.billing_add_service_line(p_org, invoice_id, 'service', v_service, null, v_today, null);
  perform private.billing_recompute(invoice_id, v_today);
  number := private.billing_finalize(p_org, invoice_id, p_actor);
  -- D-52: while Demandes is reserved for its testers, the PDF only (no email queued).
  perform private.billing_queue_delivery(p_org, 'invoice', invoice_id,
                                         not private.billing_source_sends_held(p_org, 'waitlist_fee'), false, p_actor);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. The deliveries' choke point: no email for an invoice whose source module is reserved
-- -----------------------------------------------------------------------------
create or replace function public.billing_document_for_service(p_org_id uuid, p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.billing_deliveries;
  v_doc_id uuid;
  v_doc jsonb;
  v_file uuid;
  v_client uuid;
  v_payer uuid;
  v_email text;
  v_skip text;
begin
  select x.* into d from public.billing_deliveries x where x.org_id = p_org_id and x.id = p_delivery_id and x.status = 'sending';
  if d.id is null then
    return null;
  end if;
  v_doc_id := case d.kind when 'invoice' then d.invoice_id when 'reminder' then d.invoice_id when 'credit_note' then d.credit_note_id
                          when 'receipt' then d.receipt_id else d.statement_id end;
  -- A reminder prints the invoice (its PDF, kept on the invoice).
  v_doc := private.billing_document(p_org_id, case when d.kind = 'reminder' then 'invoice' else d.kind end, v_doc_id);
  if v_doc is null then
    return null;
  end if;
  v_file := case d.kind
    when 'invoice' then (select i.pdf_file_id from public.invoices i where i.id = d.invoice_id)
    when 'reminder' then (select i.pdf_file_id from public.invoices i where i.id = d.invoice_id)
    when 'credit_note' then (select c.pdf_file_id from public.credit_notes c where c.id = d.credit_note_id)
    when 'receipt' then (select r.pdf_file_id from public.receipts r where r.id = d.receipt_id)
    else (select s.pdf_file_id from public.statements s where s.id = d.statement_id) end;
  v_client := (v_doc -> 'client' ->> 'id')::uuid;
  v_payer := (v_doc -> 'payer' ->> 'id')::uuid;
  if not d.send_email then
    v_skip := 'not_requested';
  elsif not public.module_open_to_all_for_org(p_org_id, 'billing') then
    v_skip := 'reserved';
  elsif d.invoice_id is not null
        and private.billing_source_sends_held(p_org_id, (select i.source_type from public.invoices i where i.id = d.invoice_id)) then
    -- D-52: the invoice's source module (Demandes, for a waitlist fee) is reserved for its testers.
    v_skip := 'reserved';
  else
    v_email := case when d.kind = 'statement' then private.billing_payer_email(p_org_id, v_client, v_payer)
                    else private.billing_invoice_payer_email((select i from public.invoices i where i.id = (v_doc -> 'invoice' ->> 'id')::uuid)) end;
    if v_email is null then
      v_skip := 'no_email';
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'delivery_id', d.id, 'kind', d.kind, 'document_id', v_doc_id, 'explicit', d.explicit, 'attempts', d.attempts,
    'document', v_doc,
    'stored', (select pg_catalog.jsonb_build_object('file_id', f.id, 'bucket', f.bucket, 'object_path', f.object_path)
                 from public.stored_files f where f.id = v_file and f.status = 'ready'),
    'logo', (select pg_catalog.jsonb_build_object('bucket', f.bucket, 'object_path', f.object_path)
               from public.organizations o join public.stored_files f on f.id = o.logo_file_id and f.status = 'ready'
              where o.id = p_org_id),
    'email', case when v_skip is null then pg_catalog.jsonb_build_object(
               'to', v_email, 'first_name', v_doc -> 'payer' ->> 'first_name', 'language', v_doc -> 'payer' ->> 'language') end,
    'skip_reason', v_skip,
    'reminder', case when d.kind = 'reminder' then (
      select pg_catalog.jsonb_build_object('step', r.step, 'days', private.billing_today(p_org_id) - i.due_on,
                                           'balance_cents', i.total_cents - i.paid_cents)
        from public.billing_dunning_runs r join public.invoices i on i.id = r.invoice_id
       where r.delivery_id = d.id) end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The next-day card charge skips an invoice whose source module is reserved
-- -----------------------------------------------------------------------------
create or replace function public.stripe_charges_due_for_service(p_org_id uuid, p_limit int default 100)
returns table (invoice_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
    from public.invoices i
    join public.stripe_customers s on s.org_id = i.org_id and s.payer_client_id = i.payer_client_id and s.card_status = 'active'
   where i.org_id = p_org_id and i.status = 'issued' and i.total_cents - i.paid_cents > 0 and i.payer_kind <> 'organisation'
     and i.source_type <> 'import'
     and coalesce(i.finalized_at, i.issued_on::timestamptz) >= s.consent_at
     and i.issued_on >= private.billing_today(p_org_id) - 14
     and public.module_open_to_all_for_org(p_org_id, 'billing')
     and not private.billing_source_sends_held(p_org_id, i.source_type)
     and private.billing_stripe_configured(p_org_id)
     and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and (c.kind = 'auto' or c.status = 'pending'))
   order by i.issued_on, i.number
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- -----------------------------------------------------------------------------
-- 5. « Facturer l'inscription »: made while reserved, its email held
-- -----------------------------------------------------------------------------
drop function public.invoice_waitlist_fee(uuid);
create function public.invoice_waitlist_fee(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  r record;
  v_held text;
begin
  perform private.demandes_require('demandes.waitlist');
  if not public.module_enabled_for_org(private.current_user_org_id(), 'billing') then
    raise exception 'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).' using errcode = 'P0001', hint = 'billing';
  end if;
  v := private.waitlist_lock(p_entry_id);
  if v.client_id is null then
    raise exception 'Liez d''abord l''inscription au dossier du client.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if v.fee_status <> 'to_invoice' then
    raise exception 'Les frais de cette inscription ne sont pas « À facturer ».' using errcode = 'P0001', hint = 'fee_status';
  end if;
  -- P3-40 (D-52): the invoice is made either way; Facturation holds its email while Demandes (or
  -- Facturation itself) is reserved for its testers. Said back for the toast.
  v_held := case when private.module_sends_held(v.org_id, 'demandes') then 'demandes'
                 when not public.module_open_to_all_for_org(v.org_id, 'billing') then 'billing' end;
  select x.* into r from private.billing_create_waitlist_fee_invoice(v.org_id, v.client_id, v.id, auth.uid()) x;
  perform pg_catalog.set_config('app.audit_source', 'rpc:invoice_waitlist_fee', true);
  update public.waitlist_entries e set fee_status = 'invoiced', fee_invoice_id = r.invoice_id, fee_waived_reason = null
   where e.id = v.id;
  return pg_catalog.jsonb_build_object('number', r.number, 'email_held_by', v_held);
end;
$$;
revoke all on function public.invoice_waitlist_fee(uuid) from public, anon;
grant execute on function public.invoice_waitlist_fee(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
