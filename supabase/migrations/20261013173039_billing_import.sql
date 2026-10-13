-- =============================================================================
-- Facturation: the GOrendezvous import of invoices, lines and payments (I3)
-- =============================================================================
-- Asked:     coordinator, 2026-10-13; agreed with lane C (the import tool, FS)
-- Needs:     *_clients_import_match.sql, *_services_code_lookup.sql
-- Decisions: BI-20 (decisions log)
--
-- `import_invoice(row, dry_run)` (billing.manage; the terminal script signs in as the person
-- running it, as I1): one historical invoice of GOrendezvous's « Revenus » exports, with its
-- lines and its payments (refunds too), all or nothing.
-- * Its GOrendezvous number « 2026-0001234 » is `external_ref` « gorendezvous:2026-0001234 »
--   (an invoice already imported comes back `skipped`: a run resumes) and its number here
--   « 2026-1234 » (the year's sequence follows: the next invoice made here comes after it).
-- * The dossier: `client_ref` (« gorendezvous:<ClientId> », the tool's --clients-map) or the name
--   (Clients' `clients_import_match`). Not found or several: `unmatched` with its reason, never
--   an error (the tool lists them; a re-run with the map adds them).
-- * Issued on its GOrendezvous date (`issued_on`, `due_on`, `finalized_at` that day: Rapports and
--   FS's card charges read them), billed to the client, its lines and totals as exported (never
--   recomputed: Σ lines must equal the invoice, else a row error), a line's service by its code.
-- * Payments by mode code (`payment_modes`), `external_ref` « <invoice ref>:<n> »; a refund is a
--   `refunds` row `recorded` on the invoice's latest payment that covers it.
-- * Historical: no delivery (no email, no PDF, no receipt), no QuickBooks event (already in
--   QuickBooks: `billing_queue_sync` skips `import`), never in the morning queue (an invoice, not
--   a queue item), never reminded nor blocking a booking (the dunning run and the balance rule,
--   replaced below, skip `import`; the clinic follows them in « Factures en retard »).
-- Returns {status: ok | skipped | unmatched | error, dry_run, id, number, reason, errors:
-- [{field, message}]}: a French message with its field, never a value.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_import', true);

create function public.import_invoice(p_row jsonb, p_dry_run boolean default true)
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
      if not exists (select 1 from public.payment_modes m where m.org_id = v_org and m.code = v_pay ->> 'mode_code') then
        raise exception 'Paiement % : mode de paiement inconnu.', v_n using errcode = 'P0001', hint = 'payments';
      end if;
      begin
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
       order by p.paid_on desc, p.external_ref desc limit 1;
      if v_payment is null then
        raise exception 'Remboursement % : aucun paiement de la facture ne le couvre.', v_n using errcode = 'P0001', hint = 'refunds';
      end if;
      begin
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
revoke all on function public.import_invoice(jsonb, boolean) from public, anon;
grant execute on function public.import_invoice(jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Imported invoices are never reminded nor block a booking
-- -----------------------------------------------------------------------------
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.module_enabled_for_org(p_org, 'billing')
     and exists (
       select 1
         from public.billing_settings s
         join public.invoices i on i.org_id = s.org_id
        where s.org_id = p_org and s.dunning_from is not null
          and i.client_id = p_client_id and i.status = 'issued' and i.total_cents > i.paid_cents
          and i.source_type <> 'import'
          and i.issued_on >= s.dunning_from
          and i.due_on <= private.billing_today(p_org) - s.block_after_days)
$$;

create or replace function private.billing_run_dunning(p_org uuid, p_today date)
returns int
language plpgsql
set search_path = ''
as $$
declare
  i record;
  v_days int;
  v_step smallint;
  v_delivery uuid;
  v_count int := 0;
  v_client text;
  v_pro record;
begin
  for i in select inv.*, s.dunning_days, s.block_after_days
             from public.invoices inv join public.billing_settings s on s.org_id = inv.org_id
            where inv.org_id = p_org and s.dunning_from is not null and inv.status = 'issued'
              and inv.source_type <> 'import'
              and inv.total_cents > inv.paid_cents and inv.issued_on >= s.dunning_from and inv.due_on < p_today
            order by inv.due_on loop
    v_days := p_today - i.due_on;
    select max(x) into v_step from pg_catalog.unnest(i.dunning_days) x
     where x <= v_days and not exists (select 1 from public.billing_dunning_runs r where r.invoice_id = i.id and r.step = x);
    if v_step is not null then
      v_delivery := private.billing_queue_delivery(p_org, 'reminder', i.id, true, false, null);
      insert into public.billing_dunning_runs (org_id, invoice_id, step, run_on, delivery_id)
      select p_org, i.id, x, p_today, case when x = v_step then v_delivery end
        from pg_catalog.unnest(i.dunning_days) x
       where x <= v_step and not exists (select 1 from public.billing_dunning_runs r where r.invoice_id = i.id and r.step = x);
      v_count := v_count + 1;
    end if;
    if v_days >= i.block_after_days then
      select n.display_name into v_client from private.clients_display_names(p_org, array[i.client_id]) n;
      perform private.notify(p_org, 'billing', 'billing.balance_due', 'important',
        pg_catalog.left('Solde impayé : ' || coalesce(v_client, 'un client'), 200),
        pg_catalog.left('La facture ' || i.number || ' est impayée depuis ' || v_days || ' jours ('
                        || private.billing_format_money(i.total_cents - i.paid_cents)
                        || '). Un nouveau rendez-vous demande une exception approuvée.', 500),
        '/facturation/factures/' || i.id::text, 'invoice', i.id, 'billing.view', null, 'balance:' || i.id::text, null);
      for v_pro in select distinct l.professional_id, private.professional_profile_id(p_org, l.professional_id) as profile_id
                     from public.invoice_lines l where l.invoice_id = i.id and l.professional_id is not null loop
        if v_pro.profile_id is not null and exists (select 1 from public.profiles p where p.user_id = v_pro.profile_id and p.status = 'active') then
          perform private.notify(p_org, 'billing', 'billing.balance_due', 'normal',
            pg_catalog.left('Solde impayé : ' || coalesce(v_client, 'un client'), 200),
            'Votre client a un solde impayé depuis ' || v_days || ' jours : un nouveau rendez-vous demande une exception approuvée par la clinique.',
            '/mon-agenda', 'invoice', i.id, 'billing.self', v_pro.profile_id,
            'balance:' || i.id::text || ':' || v_pro.professional_id::text, null);
        end if;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
