-- =============================================================================
-- Facturation: imported « Note de crédit » payments (BI-27, déléguée — révisable)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14. #171 (I-22) made `import_invoice` refuse a payment in mode
--          `credit_note`, which blocked the real GOrendezvous import (its « Revenus » exports name
--          « Note de crédit » as a payment method).
--
-- An imported « Note de crédit » is an **imported credit** on its invoice:
-- * `import_invoice` accepts mode `credit_note` (the #171 guards stay: an active mode, no future
--   date, at most 200 of each). It is the only path: record_payment, the Stripe / Interac
--   callbacks and the third-party payers' payments refuse `credit_note`, and a new check ties the
--   mode to an imported payment (`external_ref` « gorendezvous:… », written only by the import).
-- * It counts in `paid_cents` (`billing_apply_payments` sums every payment): balances match
--   GOrendezvous.
-- * Never in QuickBooks: `billing_queue_sync` already skips imported invoices; on top of it,
--   `billing_payment_for_sync` no longer returns a `credit_note` payment, so a payment or refund
--   push of one is `gone`, never sent.
-- * Never refundable: `refund_payment` refuses it (French P0001); the invoice page hides
--   « Rembourser » for it. No receipt (the import never makes one). Dunning and the balance rule
--   already skip imported invoices.
-- * An imported refund (a negative payment of the export) goes on a payment of its own mode first
--   (`mode_code` in the refund row, from the tool), then as before on the latest that covers it.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_import_credit_notes', true);

-- -----------------------------------------------------------------------------
-- Only an imported payment is in « Note de crédit »
-- -----------------------------------------------------------------------------
-- NOT VALID then VALIDATE: the scan takes a light lock (payments is small; no row breaks it:
-- every path refused the mode until now).
alter table public.payments
  add constraint payments_credit_note_imported_check
  -- coalesce: a null ref would leave the check unknown, which passes.
  check (mode_code <> 'credit_note' or coalesce(external_ref, '') like 'gorendezvous:%') not valid;
alter table public.payments validate constraint payments_credit_note_imported_check;

-- -----------------------------------------------------------------------------
-- import_invoice: « Note de crédit » accepted; a refund on a payment of its own mode first
-- -----------------------------------------------------------------------------
-- Latest body: 20261014042305_clients_imports_security_fixes.sql.
create or replace function public.import_invoice(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_dry boolean := coalesce(p_dry_run, true);
  v_gor text;
  v_ref text;
  v_year int;
  v_seq int;
  v_number text;
  v_issued date;
  v_match record;
  v_tz text;
  v_id uuid;
  v_line jsonb;
  v_pos int := 0;
  v_code int;
  v_pro uuid;
  v_qty numeric;
  v_unit int;
  v_sub int;
  v_gst int;
  v_qst int;
  v_total int;
  v_lines_total int := 0;
  v_pay jsonb;
  v_n int := 0;
  v_payment uuid;
  v_amount int;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'lines', '[]')) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'payments', '[]')) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'refunds', '[]')) <> 'array' then
    raise exception 'Une ligne d''import est un objet JSON (lines, payments, refunds : des listes).' using errcode = '22023';
  end if;
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  v_gor := pg_catalog.btrim(coalesce(p_row ->> 'gorendezvous_number', ''));
  if v_gor !~ '^[0-9]{4}-[0-9]{1,9}$' or pg_catalog.substr(v_gor, 6)::bigint = 0 then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'gorendezvous_number',
        'message', 'Le numéro GOrendezvous est requis (AAAA-N).')));
  end if;
  v_ref := 'gorendezvous:' || v_gor;
  v_year := pg_catalog.substr(v_gor, 1, 4)::int;
  v_seq := pg_catalog.substr(v_gor, 6)::int;
  v_number := v_year || '-' || v_seq;

  -- One run at a time per invoice: two runs of the same file never both create it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.import:' || v_org::text || ':' || v_ref, 0));
  select i.id, i.number into v_match from public.invoices i where i.org_id = v_org and i.external_ref = v_ref;
  if v_match.id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_match.id, 'number', v_match.number, 'reason', 'Déjà importée');
  end if;

  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'number', v_number,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;

  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');
  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    if pg_catalog.jsonb_array_length(coalesce(p_row -> 'lines', '[]')) > 200
       or pg_catalog.jsonb_array_length(coalesce(p_row -> 'payments', '[]')) > 200
       or pg_catalog.jsonb_array_length(coalesce(p_row -> 'refunds', '[]')) > 200 then
      raise exception 'Une facture importée a au plus 200 lignes, 200 paiements et 200 remboursements.' using errcode = 'P0001', hint = 'lines';
    end if;
    begin
      v_issued := (p_row ->> 'issued_on')::date;
      v_sub := (p_row ->> 'subtotal_cents')::int;
      v_gst := coalesce((p_row ->> 'gst_cents')::int, 0);
      v_qst := coalesce((p_row ->> 'qst_cents')::int, 0);
      v_total := (p_row ->> 'total_cents')::int;
    exception when others then
      raise exception 'Une date ou un montant de la facture est illisible.' using errcode = 'P0001', hint = 'total_cents';
    end;
    if v_issued is null or v_total is null then
      raise exception 'La date et le total de la facture sont requis.' using errcode = 'P0001', hint = 'issued_on';
    end if;
    if extract(year from v_issued)::int <> v_year then
      raise exception 'L''année du numéro n''est pas celle de la date de la facture.' using errcode = 'P0001', hint = 'issued_on';
    end if;
    v_sub := coalesce(v_sub, v_total - v_gst - v_qst);
    if v_sub + v_gst + v_qst <> v_total or v_total < 0 then
      raise exception 'Le sous-total et les taxes ne font pas le total de la facture.' using errcode = 'P0001', hint = 'total_cents';
    end if;
    if pg_catalog.jsonb_array_length(coalesce(p_row -> 'lines', '[]')) = 0 then
      raise exception 'Une facture importée a au moins une ligne.' using errcode = 'P0001', hint = 'lines';
    end if;
    if exists (select 1 from public.invoices i where i.org_id = v_org and i.number = v_number) then
      raise exception 'Le numéro % existe déjà dans Facturation.', v_number using errcode = 'P0001', hint = 'gorendezvous_number';
    end if;
    perform private.billing_check_client(v_org, v_match.client_id);

    insert into public.invoices (org_id, number, year, seq, status, client_id, payer_kind, payer_client_id, issued_on, due_on,
                                 gst_rate, qst_rate, subtotal_cents, gst_cents, qst_cents, total_cents,
                                 source_type, external_ref, created_by, finalized_at, finalized_by)
    values (v_org, v_number, v_year, v_seq, 'issued', v_match.client_id, 'client', v_match.client_id, v_issued, v_issued,
            case when v_gst > 0 then private.billing_tax_rate(v_org, 'gst', v_issued) else 0 end,
            case when v_qst > 0 then private.billing_tax_rate(v_org, 'qst', v_issued) else 0 end,
            v_sub, v_gst, v_qst, v_total, 'import', v_ref, auth.uid(),
            (v_issued::timestamp at time zone v_tz), auth.uid())
    returning id into v_id;

    for v_line in select x.value from pg_catalog.jsonb_array_elements(p_row -> 'lines') x loop
      v_pos := v_pos + 1;
      begin
        v_code := nullif(v_line ->> 'service_code', '')::int;
        v_pro := nullif(v_line ->> 'professional_id', '')::uuid;
        v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
        v_unit := (v_line ->> 'unit_price_cents')::int;
        v_gst := coalesce((v_line ->> 'gst_cents')::int, 0);
        v_qst := coalesce((v_line ->> 'qst_cents')::int, 0);
        v_total := (v_line ->> 'total_cents')::int;
      exception when others then
        raise exception 'Ligne % : un code ou un montant est illisible.', v_pos using errcode = 'P0001', hint = 'lines';
      end;
      if v_total is null then
        raise exception 'Ligne % : le total est requis.', v_pos using errcode = 'P0001', hint = 'lines';
      end if;
      begin
        insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, service_id, service_code,
                                          description, quantity, unit_price_cents, price_source, tax_rule,
                                          subtotal_cents, gst_cents, qst_cents, total_cents)
        values (v_org, v_id, v_pos,
                case when private.service_id_by_code(v_org, v_code) is null then 'adjustment' else 'service' end,
                v_pro, private.service_id_by_code(v_org, v_code), v_code,
                coalesce(nullif(pg_catalog.left(pg_catalog.btrim(coalesce(v_line ->> 'description', '')), 300), ''), 'Service GOrendezvous'),
                v_qty, v_unit, 'import',
                case when v_gst + v_qst > 0 then 'taxable' else 'exempt' end,
                v_total - v_gst - v_qst, v_gst, v_qst, v_total);
      exception when check_violation or foreign_key_violation or numeric_value_out_of_range then
        raise exception 'Ligne % : une quantité, un prix ou un professionnel est hors limites.', v_pos using errcode = 'P0001', hint = 'lines';
      end;
      v_lines_total := v_lines_total + v_total;
    end loop;
    if v_lines_total <> (p_row ->> 'total_cents')::int then
      raise exception 'Les lignes ne font pas le total de la facture.' using errcode = 'P0001', hint = 'lines';
    end if;

    for v_pay in select x.value from pg_catalog.jsonb_array_elements(coalesce(p_row -> 'payments', '[]')) x loop
      v_n := v_n + 1;
      -- As record_payment: an active mode. « Note de crédit » is accepted here only (BI-27): an
      -- imported credit, marked by its `gorendezvous:` external_ref (payments_credit_note_imported_check).
      if not exists (select 1 from public.payment_modes m where m.org_id = v_org and m.code = v_pay ->> 'mode_code' and m.is_active) then
        raise exception 'Paiement % : mode de paiement inconnu ou inactif.', v_n using errcode = 'P0001', hint = 'payments';
      end if;
      begin
        if (v_pay ->> 'paid_on')::date > private.billing_today(v_org) then
          raise exception 'Paiement % : la date de paiement est dans le futur.', v_n using errcode = 'P0001', hint = 'payments';
        end if;
        insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, external_ref, created_by)
        values (v_org, v_id, v_match.client_id, v_pay ->> 'mode_code', (v_pay ->> 'amount_cents')::int, (v_pay ->> 'paid_on')::date,
                v_ref || ':' || v_n, auth.uid());
      exception when check_violation or invalid_text_representation or invalid_datetime_format or not_null_violation
                     or numeric_value_out_of_range or datetime_field_overflow then
        raise exception 'Paiement % : la date ou le montant est illisible.', v_n using errcode = 'P0001', hint = 'payments';
      end;
    end loop;

    v_n := 0;
    for v_pay in select x.value from pg_catalog.jsonb_array_elements(coalesce(p_row -> 'refunds', '[]')) x loop
      v_n := v_n + 1;
      v_amount := (v_pay ->> 'amount_cents')::int;
      select p.id into v_payment from public.payments p
       where p.invoice_id = v_id and p.amount_cents >= coalesce(v_amount, 0)
       -- A payment of the refund's own mode first (a negative « Note de crédit » on an imported credit).
       order by (p.mode_code is distinct from v_pay ->> 'mode_code'), p.paid_on desc, p.external_ref desc limit 1;
      if v_payment is null then
        raise exception 'Remboursement % : aucun paiement de la facture ne le couvre.', v_n using errcode = 'P0001', hint = 'refunds';
      end if;
      begin
        if (v_pay ->> 'paid_on')::date > private.billing_today(v_org) then
          raise exception 'Remboursement % : la date est dans le futur.', v_n using errcode = 'P0001', hint = 'refunds';
        end if;
        insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status, created_by, processed_at)
        values (v_org, v_payment, v_id, v_amount, 'Remboursement importé de GOrendezvous', 'recorded', auth.uid(),
                ((v_pay ->> 'paid_on')::date::timestamp at time zone v_tz));
      exception when check_violation or invalid_text_representation or invalid_datetime_format or not_null_violation then
        raise exception 'Remboursement % : la date ou le montant est illisible.', v_n using errcode = 'P0001', hint = 'refunds';
      end;
      v_payment := null;
    end loop;

    if coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = v_id), 0)
       - coalesce((select sum(r.amount_cents) from public.refunds r where r.invoice_id = v_id), 0)
       > (select i.total_cents from public.invoices i where i.id = v_id) then
      raise exception 'Les paiements dépassent le total de la facture.' using errcode = 'P0001', hint = 'payments';
    end if;
    if coalesce((select sum(r.amount_cents) from public.refunds r where r.invoice_id = v_id), 0)
       > coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = v_id), 0) then
      raise exception 'Les remboursements dépassent les paiements de la facture.' using errcode = 'P0001', hint = 'refunds';
    end if;
    perform private.billing_apply_payments(v_id);
    -- The year's numbering goes on after the imported numbers.
    insert into public.invoice_sequences as s (org_id, kind, year, last_number)
    values (v_org, 'invoice', v_year, v_seq)
    on conflict (org_id, kind, year) do update set last_number = greatest(s.last_number, excluded.last_number);

    if v_dry then
      raise exception 'import_invoice: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'number', v_number, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_id end, 'number', v_number);
end;
$$;

-- -----------------------------------------------------------------------------
-- refund_payment: an imported credit is never refunded
-- -----------------------------------------------------------------------------
-- Latest body: 20261013140557_billing_follow_up.sql.
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
-- QuickBooks: an imported credit is never pushed (null → the push is `gone`)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013113521_billing_queue_payments.sql.
create or replace function private.billing_payment_for_sync(p_org uuid, p_payment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', p.id, 'invoice_id', p.invoice_id, 'invoice_number', i.number, 'client_id', i.client_id,
           'payer_client_id', p.payer_client_id, 'mode_code', p.mode_code, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
           'external_ref', p.external_ref)
    from public.payments p join public.invoices i on i.id = p.invoice_id
   where p.org_id = p_org and p.id = p_payment_id
     and p.mode_code <> 'credit_note'  -- an imported credit: never in QuickBooks (BI-27)
$$;

select pg_catalog.set_config('app.audit_source', '', true);
