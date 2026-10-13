-- =============================================================================
-- Facturation, FQ follow-up: third-party payers (IVAC, PAE) to QuickBooks
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FQ, after FP); roadmap §2.6 bis
-- Decisions: FQ-13 (this migration), FP-3 (the payer invoices), R-30 (parent and sub-customers)
-- Needs:     FP part 1 (*_billing_third_party_payers.sql: `payer_organisations`, the invoices'
--            `payer_kind = 'organisation'`, `payer_reference`, the lines `payer_share` /
--            `payer_claim`, `billing_invoice_for_sync`'s `payer_organisation`); FQ part 2 and its
--            follow-up (*_billing_qbo_push.sql, *_billing_qbo_refunds.sql).
--
-- * An organisation's invoice (IVAC, a PAE) goes to the organisation's customer in QuickBooks,
--   the parent, through a sub-customer for the dossier « facturé avec le parent » (R-30 as for a
--   client payer): the organisation's customer is the company's customer of the same name when
--   it exists (GOrendezvous made « IVAC »), else made on first use; the dossier's is made once
--   per (organisation, dossier). Both kept in `qbo_organisation_links` (`qbo_links` holds client
--   payers only: its payer is a client file). Its credit memo and payments follow the invoice's
--   customer, as for any invoice.
-- * Lines: `payer_claim` (a session's share claimed) goes on the item of its service code, as a
--   session; `payer_share` (negative, on the client's invoice: the part the payer covers) on one
--   item made for it on « Services » (« Part payée par un tiers »), exempt; both keep their own
--   text. The payer's reference (the file number) goes in the invoice's memo.
-- * Clients' merge: Facturation's handler (`billing_reassign_client`, from FP's version) also
--   moves the organisation's dossier links.
-- Additive: one table, two functions widened (same signatures), one new service RPC.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:billing_qbo_payers', true);

create table public.qbo_organisation_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  payer_organisation_id uuid not null,
  client_id uuid,
  qbo_customer_id text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint qbo_organisation_links_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_organisation_links_organisation_fkey foreign key (org_id, payer_organisation_id)
    references public.payer_organisations(org_id, id),
  constraint qbo_organisation_links_client_fkey foreign key (org_id, client_id) references public.clients(org_id, id),
  constraint qbo_organisation_links_kind_check check (kind in ('organisation', 'dossier')),
  constraint qbo_organisation_links_shape_check check ((kind = 'dossier') = (client_id is not null)),
  constraint qbo_organisation_links_source_check check (source in ('matched', 'created')),
  constraint qbo_organisation_links_customer_check check (qbo_customer_id ~ '^[0-9]{1,32}$')
);
create unique index qbo_organisation_links_pair_key
  on public.qbo_organisation_links (connection_id, kind, payer_organisation_id, client_id) nulls not distinct;
create unique index qbo_organisation_links_customer_key on public.qbo_organisation_links (connection_id, qbo_customer_id);
create index qbo_organisation_links_org_connection_idx on public.qbo_organisation_links (org_id, connection_id);
create index qbo_organisation_links_org_organisation_idx on public.qbo_organisation_links (org_id, payer_organisation_id);
create index qbo_organisation_links_org_client_idx on public.qbo_organisation_links (org_id, client_id);
revoke all on public.qbo_organisation_links from anon, authenticated;
grant select on public.qbo_organisation_links to authenticated;
alter table public.qbo_organisation_links enable row level security;
create policy qbo_organisation_links_select on public.qbo_organisation_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_organisation_links_audit after insert or update or delete on public.qbo_organisation_links
  for each row execute function private.audit_trigger();

-- A line's name when its service has none: by its kind (the payer lines added).
create or replace function private.qbo_line_kind_name(p_line_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_line_type
           when 'file_opening' then 'Ouverture de dossier'
           when 'cancellation_fee' then 'Frais d''annulation'
           when 'ivac_gap' then 'Écart IVAC'
           when 'payer_share' then 'Part payée par un tiers'
           when 'payer_claim' then 'Séances facturées au payeur'
           else 'Services' end
$$;
revoke all on function private.qbo_line_kind_name(text) from public, anon, authenticated, service_role;

-- A customer the push matched or made for an organisation (its parent) or its dossier.
create function public.record_qbo_organisation_link_for_service(
  p_org_id uuid, p_kind text, p_organisation uuid, p_client uuid, p_qbo_customer_id text, p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id;
  if v_connection is null or p_kind not in ('organisation', 'dossier') or p_source not in ('matched', 'created')
     or not exists (select 1 from public.payer_organisations o where o.org_id = p_org_id and o.id = p_organisation) then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'fn:qbo-push', true);
  insert into public.qbo_organisation_links (connection_id, org_id, kind, payer_organisation_id, client_id, qbo_customer_id, source)
  values (v_connection, p_org_id, p_kind, p_organisation, case when p_kind = 'dossier' then p_client end, p_qbo_customer_id, p_source)
  on conflict do nothing;
end;
$$;
revoke all on function public.record_qbo_organisation_link_for_service(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_qbo_organisation_link_for_service(uuid, text, uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- The prepare, widened (same signature; from *_billing_qbo_refunds.sql)
-- -----------------------------------------------------------------------------
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
  v_organisation uuid;
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
  -- A third-party payer's invoice (FP-3): billed to its organisation (FQ-13).
  v_organisation := case when v_invoice ->> 'payer_kind' = 'organisation' then (v_invoice -> 'payer_organisation' ->> 'id')::uuid end;

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
           'description', case when l ->> 'line_type' in ('cancellation_fee', 'payer_share', 'payer_claim') and il.description is not null then il.description
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
    -- FQ-13: the organisation (the parent customer), its link or the company's customer of its name.
    'organisation', case when v_organisation is not null then pg_catalog.jsonb_build_object(
        'id', v_organisation, 'kind', v_invoice -> 'payer_organisation' ->> 'kind', 'name', v_invoice -> 'payer_organisation' ->> 'name',
        'reference', v_invoice ->> 'payer_reference') end,
    'organisation_customer_id', case when v_organisation is not null then coalesce(
        (select l.qbo_customer_id from public.qbo_organisation_links l
          where l.connection_id = v_connection and l.kind = 'organisation' and l.payer_organisation_id = v_organisation),
        (select q.qbo_id from public.qbo_customers q
          where q.connection_id = v_connection and q.active and not q.is_job
            and pg_catalog.lower(coalesce(q.company_name, q.display_name)) = pg_catalog.lower(v_invoice -> 'payer_organisation' ->> 'name')
          order by (pg_catalog.lower(q.display_name) = pg_catalog.lower(v_invoice -> 'payer_organisation' ->> 'name')) desc, q.qbo_id
          limit 1)) end,
    'organisation_matched', case when v_organisation is not null then not exists (
        select 1 from public.qbo_organisation_links l
         where l.connection_id = v_connection and l.kind = 'organisation' and l.payer_organisation_id = v_organisation) end,
    'organisation_dossier_customer_id', case when v_organisation is not null then
        (select l.qbo_customer_id from public.qbo_organisation_links l
          where l.connection_id = v_connection and l.kind = 'dossier' and l.payer_organisation_id = v_organisation
            and l.client_id = v_client) end,
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

-- -----------------------------------------------------------------------------
-- Clients' merge: Facturation's handler, widened (from *_billing_third_party_payers.sql)
-- -----------------------------------------------------------------------------
create or replace function private.billing_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.invoices i set client_id = p_new,
         payer_client_id = case when i.payer_client_id = p_old then p_new else i.payer_client_id end,
         payer_kind = case when i.payer_kind = 'organisation' then 'organisation'
                           when (case when i.payer_client_id = p_old then p_new else i.payer_client_id end) = p_new then 'client' else i.payer_kind end
   where i.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.invoices i set payer_client_id = p_new,
         payer_kind = case when i.client_id = p_new then 'client' else 'relation' end
   where i.payer_client_id = p_old and i.payer_kind <> 'organisation';
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d
   where d.client_id = p_old
     and exists (select 1 from public.billing_payer_defaults k where k.client_id = p_new and k.effective_from = d.effective_from);
  update public.billing_payer_defaults d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.billing_payer_defaults d set payer_client_id = p_new where d.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- F2: payments, statements, the agreement (the kept dossier's own wins).
  update public.payments p set payer_client_id = p_new where p.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.statements s set client_id = p_new where s.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.statements s set payer_client_id = p_new where s.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.special_agreements a set is_active = false, ended_at = pg_catalog.now()
   where a.client_id = p_old and a.is_active
     and exists (select 1 from public.special_agreements k where k.client_id = p_new and k.is_active);
  update public.special_agreements a set client_id = p_new where a.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- F3: the cancellation-fee decisions.
  update public.cancellation_fee_decisions c set client_id = p_new where c.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- FQ (20261013111236_billing_quickbooks): the QuickBooks matches and links, as lane B wrote them.
  update public.qbo_customer_matches m
     set candidate_client_ids = pg_catalog.array_replace(m.candidate_client_ids, p_old, p_new)
   where p_old = any (m.candidate_client_ids);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_customer_matches m set client_id = p_new
   where m.client_id = p_old
     and not exists (select 1 from public.qbo_customer_matches k
                      where k.connection_id = m.connection_id and k.client_id = p_new and k.status = 'linked');
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set payer_client_id = p_new
   where l.payer_client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = l.kind and k.payer_client_id = p_new
                        and k.client_id is not distinct from (case when l.client_id = p_old then p_new else l.client_id end));
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set client_id = p_new
   where l.client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = 'dossier'
                        and k.payer_client_id = l.payer_client_id and k.client_id = p_new);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- FQ-13 (lane B, *_billing_qbo_payers.sql): an organisation's dossier sub-customer follows the
  -- kept file, unless the kept file has its own under that organisation.
  update public.qbo_organisation_links l set client_id = p_new
   where l.client_id = p_old
     and not exists (select 1 from public.qbo_organisation_links k
                      where k.connection_id = l.connection_id and k.kind = 'dossier'
                        and k.payer_organisation_id = l.payer_organisation_id and k.client_id = p_new);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
